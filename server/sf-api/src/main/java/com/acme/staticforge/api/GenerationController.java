package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.FindingCountsView;
import com.acme.staticforge.api.dto.FindingFacetsView;
import com.acme.staticforge.api.dto.FindingPageView;
import com.acme.staticforge.api.dto.FindingView;
import com.acme.staticforge.api.dto.GenerationPlanView;
import com.acme.staticforge.api.dto.GenerationRequestDto;
import com.acme.staticforge.api.dto.GenerationRunView;
import com.acme.staticforge.api.dto.RecordPageView;
import com.acme.staticforge.api.dto.RunLogView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationAuthorization;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTrigger;
import com.acme.staticforge.generate.RunEvent;
import com.acme.staticforge.generate.RunLogStore;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import com.acme.staticforge.generate.insight.RunPlanStore;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualityRuleRegistry;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishRequirements;
import com.acme.staticforge.security.ProjectAuthorizationService;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Generation-run endpoints (spec §20.2). Thin controller: authorizes, maps DTOs, and delegates
 * to {@link GenerationService}. {@code GET /{runId}/events} streams progress over SSE with
 * single-node affinity (§26.2) — the emitter registry is in-memory, so a project's runs and SSE
 * subscriptions must land on the same instance.
 *
 * <p>Who may start what (M28.2.2, epic decision 7) depends on the body, so start and dry run require {@code EDITOR}
 * at the annotation and then {@link GenerationAuthorization}'s requirements for the request: {@code INCREMENTAL_BUILD}
 * for an explicit incremental run to the default target, {@code FULL_BUILD} for a full run or another target,
 * {@code DEVELOPER} for a pinned revision. An editor holding a build permission cancels the runs they started;
 * promote stays {@code DEVELOPER}.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/generations")
public class GenerationController {

    private static final long SSE_TIMEOUT_MILLIS = 30L * 60 * 1000;

    private final GenerationService generationService;
    private final GenerationAuthorization generationAuthorization;
    private final ProjectAuthorizationService projectAuth;
    private final ProjectService projectService;
    private final UserService userService;
    private final SecuritySupport securitySupport;
    private final ObjectMapper mapper;
    private final RunFindingStore findingStore;
    private final QualityRuleRegistry ruleRegistry;

    public GenerationController(
            GenerationService generationService,
            GenerationAuthorization generationAuthorization,
            ProjectAuthorizationService projectAuth,
            ProjectService projectService,
            UserService userService,
            SecuritySupport securitySupport,
            ObjectMapper mapper,
            RunFindingStore findingStore,
            QualityRuleRegistry ruleRegistry) {
        this.generationService = generationService;
        this.generationAuthorization = generationAuthorization;
        this.projectAuth = projectAuth;
        this.projectService = projectService;
        this.userService = userService;
        this.securitySupport = securitySupport;
        this.mapper = mapper;
        this.findingStore = findingStore;
        this.ruleRegistry = ruleRegistry;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<GenerationRunView> history(@PathVariable String projectKey) {
        return toViews(generationService.history(projectKey));
    }

    @PostMapping
    @PreAuthorize("@projectAuth.can(#projectKey, 'ROLE:EDITOR')")
    public ResponseEntity<GenerationRunView> start(
            @PathVariable String projectKey,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody GenerationRequestDto body) {
        authorize(projectKey, body);
        GenerationRun run = generationService.start(projectKey, toRequest(body, idempotencyKey),
                securitySupport.currentUserId());
        return ResponseEntity.accepted()
                .location(location(projectKey, run.getId()))
                .body(toView(run));
    }

    /**
     * Dry run (M22.2.1): the plan a run started now with the same request would build, with every entry's reason. Nothing
     * is rendered, written, stored or locked, so it also works while a run is active. Authorized like a start (M28.2.2):
     * it shows what the caller could run.
     */
    @AllowedOnArchivedProject("A dry run: plans a build, writes nothing.")
    @PostMapping("/plan")
    @PreAuthorize("@projectAuth.can(#projectKey, 'ROLE:EDITOR')")
    public GenerationPlanView plan(
            @PathVariable String projectKey,
            @RequestBody GenerationRequestDto body,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String rootKind,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "false") boolean validate) {
        authorize(projectKey, body);
        GenerationService.DryRun dryRun = generationService.dryRun(projectKey, toRequest(body, null), validate);
        Page<PlanEntryRecord> entries =
                PlanViews.page(dryRun.entries(), PlanViews.filter(rootKind, channel, q), PlanViews.pageable(page, size));
        return new GenerationPlanView(
                null,
                new GenerationPlanView.TargetRef(dryRun.build().target().getId(), dryRun.build().target().getName()),
                PlanViews.summary(dryRun.summary()),
                PlanViews.changedAssets(dryRun.summary()),
                PlanViews.entries(entries),
                dryRun.diagnostics(),
                PlanViews.redirectCandidates(dryRun));
    }

    /** The stored plan of a past run (M22.2.1); {@code entries} is {@code null} once retention pruned them. */
    @GetMapping("/{runId}/plan")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public GenerationPlanView storedPlan(
            @PathVariable String projectKey,
            @PathVariable long runId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String rootKind,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String q) {
        GenerationService.StoredPlan stored = generationService.storedPlan(
                projectKey, runId, PlanViews.filter(rootKind, channel, q), PlanViews.pageable(page, size));
        return new GenerationPlanView(
                runId,
                stored.target() == null
                        ? new GenerationPlanView.TargetRef(stored.run().getTargetId(), null)
                        : new GenerationPlanView.TargetRef(stored.target().getId(), stored.target().getName()),
                PlanViews.summary(stored.summary()),
                PlanViews.changedAssets(stored.summary()),
                stored.entries() == null ? null : PlanViews.entries(stored.entries()),
                null,
                null);
    }

    /** The largest page of findings. */
    static final int MAX_FINDINGS_PAGE_SIZE = 200;

    /**
     * The quality check findings of a run (M30.1.2), paged and sorted by output path, then code. Filters: {@code
     * severity} ({@code WARNING}/{@code ERROR}), {@code category} ({@code LINKS}/{@code SEO}/{@code ACCESSIBILITY}),
     * {@code code} (repeatable), {@code assetUuid}, {@code channel}, {@code locale} and {@code pathPrefix}. A run of
     * another project is {@code 404}; an invalid filter or page is {@code 400}.
     */
    @GetMapping("/{runId}/findings")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public FindingPageView findings(
            @PathVariable String projectKey,
            @PathVariable long runId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) List<String> code,
            @RequestParam(required = false) UUID assetUuid,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String locale,
            @RequestParam(required = false) String pathPrefix) {
        GenerationRun run = generationService.status(projectKey, runId);
        if (page < 0 || size < 1 || size > MAX_FINDINGS_PAGE_SIZE) {
            throw new SfException(ProblemFactory.badRequest(
                    "page must be >= 0 and size between 1 and " + MAX_FINDINGS_PAGE_SIZE + "."));
        }
        RunFindingStore.Filter filter =
                findingFilter(severity, category, code, assetUuid, channel, locale, pathPrefix);
        Page<RunFindingStore.StoredFinding> found =
                findingStore.page(run.getProjectId(), runId, filter, PlanViews.pageable(page, size));
        return new FindingPageView(
                found.getContent().stream().map(GenerationController::finding).toList(),
                new RecordPageView.PageMeta(
                        found.getSize(), found.getNumber(), found.getTotalElements(), found.getTotalPages()));
    }

    /**
     * The facet counts of a run's findings (M35.24) for the same filters as the list. Each facet ignores its own filter
     * and applies the others (see {@link FindingFacetsView}); {@code total} is the size of the filtered list. A run of
     * another project is {@code 404}; an invalid filter is {@code 400}.
     */
    @GetMapping("/{runId}/findings/facets")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public FindingFacetsView findingFacets(
            @PathVariable String projectKey,
            @PathVariable long runId,
            @RequestParam(required = false) String severity,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) List<String> code,
            @RequestParam(required = false) UUID assetUuid,
            @RequestParam(required = false) String channel,
            @RequestParam(required = false) String locale,
            @RequestParam(required = false) String pathPrefix) {
        GenerationRun run = generationService.status(projectKey, runId);
        RunFindingStore.Filter filter =
                findingFilter(severity, category, code, assetUuid, channel, locale, pathPrefix);
        RunFindingStore.Facets facets = findingStore.facets(run.getId(), filter);
        Map<String, Long> bySeverity = new LinkedHashMap<>();
        facets.severity().forEach((key, count) -> bySeverity.put(key.name(), count));
        Map<String, Long> byCategory = new LinkedHashMap<>();
        facets.category().forEach((key, count) -> byCategory.put(key.name(), count));
        List<FindingFacetsView.RuleFacet> byCode = facets.codes().stream()
                .map(c -> new FindingFacetsView.RuleFacet(
                        c.code(), ruleRegistry.find(c.code()).map(QualityRule::name).orElse(null), c.count()))
                .toList();
        return new FindingFacetsView(facets.total(), bySeverity, byCategory, byCode, facets.locale());
    }

    private static RunFindingStore.Filter findingFilter(String severity, String category, List<String> code,
            UUID assetUuid, String channel, String locale, String pathPrefix) {
        QualitySeverity severityFilter = blank(severity) ? null : QualitySeverity.parse(severity);
        if (!blank(severity) && (severityFilter == null || severityFilter == QualitySeverity.OFF)) {
            throw new SfException(ProblemFactory.badRequest("severity must be WARNING or ERROR."));
        }
        QualityCategory categoryFilter = blank(category) ? null : QualityCategory.parse(category);
        if (!blank(category) && categoryFilter == null) {
            throw new SfException(ProblemFactory.badRequest("category must be LINKS, SEO or ACCESSIBILITY."));
        }
        return new RunFindingStore.Filter(
                severityFilter,
                categoryFilter,
                code == null ? null : Set.copyOf(code.stream().filter(c -> !blank(c)).map(String::trim).toList()),
                assetUuid,
                blank(channel) ? null : channel.trim(),
                blank(locale) ? null : locale.trim(),
                blank(pathPrefix) ? null : pathPrefix);
    }

    private static FindingView finding(RunFindingStore.StoredFinding f) {
        return new FindingView(
                f.id(),
                f.code(),
                f.category() == null ? null : f.category().name(),
                f.severity() == null ? null : f.severity().name(),
                f.message(),
                f.selector(),
                f.sectionInstanceId(),
                f.carried(),
                f.outputPath(),
                f.channel(),
                f.locale(),
                f.pageNumber(),
                f.assetUuid() == null ? null : new FindingView.FindingAsset(f.assetUuid(), f.uid(), f.displayName()));
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    /** The run's finding counts; {@code null} for a run that stored none (before M30, or not finished). */
    private static FindingCountsView findingCounts(GenerationRun run) {
        RunFindingStore.Counts counts = RunFindingStore.Counts.of(run);
        if (counts == null) {
            return null;
        }
        Map<String, Integer> byCategory = new LinkedHashMap<>();
        for (QualityCategory category : QualityCategory.values()) {
            byCategory.put(category.key(), counts.byCategory().get(category));
        }
        return new FindingCountsView(counts.errors(), counts.warnings(), byCategory, counts.truncated());
    }

    @GetMapping("/{runId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public GenerationRunView status(@PathVariable String projectKey, @PathVariable long runId) {
        return toView(generationService.status(projectKey, runId));
    }

    /**
     * Developers cancel any run; an editor holding {@code INCREMENTAL_BUILD} only a run they started — a scheduled run
     * counts as started by the schedule's owner. Anyone else's run: {@code 403} with {@code ROLE:DEVELOPER}.
     */
    @AllowedOnArchivedProject("Stops a run queued or started before the project was archived; creates nothing.")
    @PostMapping("/{runId}/cancel")
    @PreAuthorize("@projectAuth.can(#projectKey, 'ROLE:EDITOR')")
    public GenerationRunView cancel(@PathVariable String projectKey, @PathVariable long runId) {
        Long caller = securitySupport.currentUserId();
        if (projectAuth.missing(projectKey, PublishRequirements.role(ProjectRole.DEVELOPER)).isPresent()) {
            GenerationRun run = generationService.status(projectKey, runId);
            if (!Objects.equals(run.getStartedBy(), caller)) {
                throw new SfException(ProblemFactory.forbidden(
                        "Only developers may cancel a run someone else started.",
                        PublishRequirements.ROLE_PREFIX + ProjectRole.DEVELOPER.name()));
            }
            projectAuth.can(projectKey, PublishPermission.INCREMENTAL_BUILD);
        }
        return toView(generationService.cancel(projectKey, runId, caller));
    }

    @PostMapping("/{runId}/promote")
    @PreAuthorize("@projectAuth.can(#projectKey, 'ROLE:DEVELOPER')")
    public GenerationRunView promote(@PathVariable String projectKey, @PathVariable long runId) {
        return toView(generationService.promote(projectKey, runId, securitySupport.currentUserId()));
    }

    /**
     * The run's log (M35.24): the lines of its {@code progress} events plus one per diagnostic code at the end. {@code
     * from} keeps the lines after that number ({@code n}) only, so a client polls a running run with the last {@code n}
     * it has. A run of another project is {@code 404}. A run that ended before logs were kept answers {@code 200} with
     * no lines and {@code pruned: true}; a log lives as long as its run.
     */
    @GetMapping("/{runId}/log")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RunLogView log(
            @PathVariable String projectKey,
            @PathVariable long runId,
            @RequestParam(defaultValue = "0") int from) {
        RunLogStore.Log log = generationService.log(projectKey, runId, from);
        return new RunLogView(
                log.lines().stream()
                        .map(l -> new RunLogView.Line(
                                l.n(), l.time(), l.stage(), l.level(), l.text(), l.files(), l.errors(), l.warnings()))
                        .toList(),
                log.complete(),
                log.truncated(),
                log.pruned());
    }

    @GetMapping("/{runId}/events")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public SseEmitter events(@PathVariable String projectKey, @PathVariable long runId) {
        generationService.status(projectKey, runId); // 404 before registering anything
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT_MILLIS);
        // Register before reading the status: a run finishing in between then either reaches this
        // emitter through the normal completion path or is seen as terminal below.
        generationService.registerEmitter(runId, emitter);
        GenerationRun run = generationService.status(projectKey, runId);
        if (!run.getStatus().isTerminal()) {
            replay(generationService.log(projectKey, runId, 0).lines(), emitter);
        }
        emitCurrent(run, emitter);
        if (run.getStatus().isTerminal()) {
            // Already finished (fast failures often are): no further events will come, so close the
            // stream after the final status instead of leaving the client waiting until timeout.
            generationService.unregisterEmitter(runId, emitter);
            emitter.complete();
        }
        return emitter;
    }

    /**
     * Sends the lines a running run has logged so far as {@code progress} events (M35.24), so a late subscriber sees the
     * whole run. Lines logged meanwhile may arrive twice: the events carry {@code n} to de-duplicate by.
     */
    private void replay(List<RunLogStore.Line> lines, SseEmitter emitter) {
        for (RunLogStore.Line line : lines) {
            try {
                emitter.send(SseEmitter.event().name("progress").data(mapper.valueToTree(RunEvent.of(line, null))));
            } catch (Exception e) {
                emitter.completeWithError(e);
                return;
            }
        }
    }

    /** Sends the current run status immediately upon subscription. */
    private void emitCurrent(GenerationRun run, SseEmitter emitter) {
        ObjectNode data = mapper.createObjectNode();
        data.put("stage", "STATUS");
        data.put("message", run.getStatus().name());
        data.put("filesWritten", run.getFilesWritten());
        data.put("errors", run.getErrorCount());
        data.put("warnings", run.getWarningCount());
        data.set("diagnostics", run.getDiagnostics());
        try {
            emitter.send(SseEmitter.event().name("progress").data(data));
        } catch (Exception e) {
            emitter.completeWithError(e);
        }
    }

    /** {@code 403} naming the permission the request needs unless the caller holds it (M28.2.2). */
    private void authorize(String projectKey, GenerationRequestDto body) {
        long projectId = projectService.requireByKey(projectKey).getId();
        projectAuth.satisfies(
                projectKey, generationAuthorization.requiredFor(projectId, body.mode(), body.targetId(), body.revision()));
    }

    private static GenerationRequest toRequest(GenerationRequestDto body, String idempotencyKey) {
        if (body.trigger() == GenerationTrigger.SCHEDULE) {
            throw new SfException(ProblemFactory.badRequest("trigger must be MANUAL or RELEASE."));
        }
        return new GenerationRequest(
                body.mode() == null ? GenerationMode.FULL : body.mode(),
                body.revision(),
                body.channels(),
                body.targetId(),
                body.folderPath(),
                body.assetUuids(),
                body.comment(),
                idempotencyKey,
                body.trigger());
    }

    private GenerationRunView toView(GenerationRun run) {
        return toView(run, starters(List.of(run)), pageNames(List.of(run)));
    }

    private List<GenerationRunView> toViews(List<GenerationRun> runs) {
        Map<Long, AppUser> starters = starters(runs);
        Map<UUID, String> names = pageNames(runs);
        return runs.stream().map(run -> toView(run, starters, names)).toList();
    }

    /** The current display names of the pages the runs held back, in one lookup (none without held-back pages). */
    private Map<UUID, String> pageNames(Collection<GenerationRun> runs) {
        Set<UUID> pages = new HashSet<>();
        long projectId = -1;
        for (GenerationRun run : runs) {
            for (JsonNode held : heldBackOf(run)) {
                UUID uuid = uuid(held.path("asset").asText(null));
                if (uuid != null) {
                    pages.add(uuid);
                    projectId = run.getProjectId();
                }
            }
        }
        return pages.isEmpty() ? Map.of() : findingStore.displayNames(projectId, pages);
    }

    private static JsonNode heldBackOf(GenerationRun run) {
        return run.getDiagnostics() == null ? com.fasterxml.jackson.databind.node.MissingNode.getInstance()
                : run.getDiagnostics().path("heldBack");
    }

    private static UUID uuid(String text) {
        try {
            return text == null ? null : UUID.fromString(text);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** The pages held back by the quality checks, as typed data (M35.24). */
    private static List<GenerationRunView.HeldBackPage> heldBack(GenerationRun run, Map<UUID, String> names) {
        List<GenerationRunView.HeldBackPage> pages = new ArrayList<>();
        for (JsonNode held : heldBackOf(run)) {
            UUID uuid = uuid(held.path("asset").asText(null));
            String name = uuid != null && names.containsKey(uuid) ? names.get(uuid) : held.path("uid").asText(null);
            pages.add(new GenerationRunView.HeldBackPage(
                    uuid, name, held.path("locale").asText(null), held.path("channel").asText(null)));
        }
        return pages;
    }

    /** What the plan endpoint has for the run (M35.24): {@code STORED}, {@code PRUNED}, {@code PENDING} or {@code NONE}. */
    static String planState(GenerationRun run) {
        JsonNode summary = run.getPlanSummary();
        if (summary == null) {
            return run.getStatus().isTerminal() ? "NONE" : "PENDING";
        }
        return RunPlanStore.available(summary) ? "STORED" : "PRUNED";
    }

    /** Who started {@code runs}, in one lookup. */
    private Map<Long, AppUser> starters(Collection<GenerationRun> runs) {
        return userService.findAllById(
                runs.stream().map(GenerationRun::getStartedBy).filter(Objects::nonNull).distinct().toList());
    }

    private GenerationRunView toView(GenerationRun run, Map<Long, AppUser> starters, Map<UUID, String> pageNames) {
        AppUser starter = run.getStartedBy() == null ? null : starters.get(run.getStartedBy());
        return new GenerationRunView(
                run.getId(),
                run.getRevisionId(),
                run.getMode().name(),
                parseChannels(run.getChannels()),
                run.getTargetId(),
                run.getStatus().name(),
                run.getStartedAt(),
                run.getFinishedAt(),
                run.getFilesWritten(),
                run.getFilesSkipped(),
                run.getBytesWritten(),
                run.getErrorCount(),
                run.getWarningCount(),
                run.getDiagnostics(),
                PlanViews.summary(run.getPlanSummary()),
                run.getComment(),
                starter == null ? null : new GenerationRunView.StartedBy(starter.getId(), starter.getDisplayName()),
                findingCounts(run),
                run.getTrigger().name(),
                planState(run),
                heldBack(run, pageNames));
    }

    private List<String> parseChannels(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return mapper.readValue(
                    json, mapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (JsonProcessingException e) {
            throw new SfException(ProblemFactory.other(
                    500, "SF-GEN-0503", "Internal Server Error", "Failed to decode run channels."));
        }
    }

    private static URI location(String projectKey, Long runId) {
        return URI.create("/api/v1/projects/" + URLEncoder.encode(projectKey, StandardCharsets.UTF_8)
                + "/generations/" + runId);
    }
}
