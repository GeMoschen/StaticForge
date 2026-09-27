package com.acme.staticforge.generate.quality;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationDiagnosticCodes;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.pipeline.RenderedFile;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.BuildPlanner;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.generate.plan.PlanRequest;
import com.acme.staticforge.generate.quality.rules.links.HeldBackTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingAnchorRule;
import com.acme.staticforge.generate.quality.rules.links.RedirectedTargetRule;
import com.acme.staticforge.generate.render.MediaOutputs;
import com.acme.staticforge.generate.render.OutputPathResolver;
import com.acme.staticforge.generate.render.RenderPipeline;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.generate.snapshot.SnapshotService;
import com.acme.staticforge.generate.snapshot.SnapshotView;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.render.RenderLimitException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.nodes.Element;
import org.jsoup.select.Selector;
import org.springframework.stereotype.Service;

/**
 * The quality checks on a page's draft (M30.3.1, epic decision 13): what the page editor's Issues panel shows while an
 * editor writes, before any build.
 *
 * <p>The page is rendered exactly as a build of the <em>drafts</em> would write it ({@link SnapshotView#DRAFT}: the
 * page's draft and the drafts of everything it reads) — so hrefs are real output paths, relative to the page's own —
 * with section markers around every rendered section instance. The enabled page rules run on that document; the link
 * rules run against the draft's planned output paths: every page output of every channel and language the planner
 * computes over the draft snapshot, every media file (and variant) of the draft and the target's site files. No other
 * page is rendered, so the rules that need the whole build are left out ({@link #NOT_RUN}), and missing anchors are
 * checked on the page itself only.
 *
 * <p>Findings are located for the editor: in the section instance whose markers enclose the element (a site rule's
 * finding by its selector), and at the field of the page's content that holds the broken reference or the media of an
 * image without text ({@link Finding#editorPath()}).
 *
 * <p>Reads only: nothing is stored, and navigation links resolve without the URL registry (which assigns on first use).
 */
@Service
public class DraftCheckService {

    /**
     * The rules a draft check doesn't run: a held-back target and a redirect exist only in a build, duplicate titles and
     * descriptions and {@code hreflang} reciprocity need the other pages' documents.
     */
    static final Set<String> NOT_RUN = Set.of(
            HeldBackTargetRule.CODE, RedirectedTargetRule.CODE, "SF-CHK-0205", "SF-CHK-0206", "SF-CHK-0210");

    /** The rules a draft check runs only in part: missing anchors are checked on the page itself only. */
    static final Set<String> RUN_IN_PART = Set.of(MissingAnchorRule.CODE);

    /** A field of a body section: {@code bodies.<body>[<index>]…}. */
    private static final Pattern SECTION_FIELD = Pattern.compile("bodies\\.([^.\\[]+)\\[(\\d+)]");

    /** Findings on an image whose media the page's content may hold: without alt, a link with only an image. */
    private static final Set<String> MEDIA_FINDINGS = Set.of("SF-CHK-0301", "SF-CHK-0302");

    private final SnapshotService snapshots;
    private final ChannelService channels;
    private final ProjectLocales projectLocales;
    private final BuildPlanner planner;
    private final RenderPipeline renderPipeline;
    private final PageRuleRunner pageRules;
    private final SiteRuleRunner siteRules;
    private final QualityRuleConfigService qualityConfig;
    private final GenerationTargetRepository targets;

    public DraftCheckService(
            SnapshotService snapshots,
            ChannelService channels,
            ProjectLocales projectLocales,
            BuildPlanner planner,
            RenderPipeline renderPipeline,
            PageRuleRunner pageRules,
            SiteRuleRunner siteRules,
            QualityRuleConfigService qualityConfig,
            GenerationTargetRepository targets) {
        this.snapshots = snapshots;
        this.channels = channels;
        this.projectLocales = projectLocales;
        this.planner = planner;
        this.renderPipeline = renderPipeline;
        this.pageRules = pageRules;
        this.siteRules = siteRules;
        this.qualityConfig = qualityConfig;
        this.targets = targets;
    }

    /**
     * What to check.
     *
     * @param revision the revision to check the drafts at (time travel); {@code null} for the current state
     * @param channel the channel key
     * @param locale the language; {@code null} for the project's default (ignored without locales)
     * @param pageNumber the page of a paginated page, clamped to its page count; {@code null} for the first
     */
    public record Request(long projectId, UUID page, Long revision, String channel, String locale, Integer pageNumber) {}

    /**
     * What a draft check found.
     *
     * @param channel the channel checked
     * @param locale the language checked; {@code null} in a project without locales
     * @param pageNumber the page number checked, after clamping
     * @param findings the findings, page rules first, then the link rules; empty when the channel isn't HTML
     * @param skippedRules the codes of the enabled rules the check didn't run, or ran in part ({@code SF-CHK-0107}:
     *     same-page anchors only) — every enabled rule when the channel isn't HTML or the page renders nothing in it
     */
    public record Result(String channel, String locale, int pageNumber, List<Finding> findings, List<String> skippedRules) {

        public Result {
            findings = List.copyOf(findings);
            skippedRules = List.copyOf(skippedRules);
        }
    }

    /**
     * Checks the draft of one page in one channel and language.
     *
     * @throws SfException {@code 404} when the page doesn't exist (or is deleted) at the revision, {@code 400} for a
     *     channel or language the project doesn't have, {@code 422} with the template's code when the page's templates
     *     don't compile or its render hits a limit (as its preview does)
     */
    public Result check(Request request) {
        long projectId = request.projectId();
        EffectiveQualityConfig config = qualityConfig.effective(projectId);
        LocaleConfig locales = LocaleConfig.orEmpty(projectLocales.forProject(projectId));
        String locale = locale(locales, request.locale());
        Map<String, ChannelOutputSettings> settings = channels.outputSettings(projectId);
        String channel = request.channel();
        if (channel == null || !settings.containsKey(channel)) {
            throw new SfException(ProblemFactory.badRequest("Unknown channel '" + channel + "'."));
        }

        Snapshot snapshot = snapshots.snapshot(projectId, request.revision(), SnapshotView.DRAFT);
        SnapshotAsset page = snapshot.asset(request.page(), locale);
        if (page == null || page.deleted() || page.type() != AssetType.PAGE) {
            throw new SfException(ProblemFactory.notFound("Page not found."));
        }
        if (!CheckEnvironment.isHtml(settings.get(channel))) {
            return notChecked(config, channel, locale, 1);
        }

        OutputPathResolver paths = OutputPathResolver.forSnapshot(snapshot, settings, locales);
        BuildPlan plan = planner.plan(
                snapshot, new PlanRequest(GenerationMode.FULL, null, null, settings.keySet(), null, null), paths);
        PlanEntry entry = entry(plan, request.page(), channel, locale, request.pageNumber());
        List<Diagnostic> errors = renderPipeline.validate(snapshot, plan.withEntries(List.of(entry)));
        if (!errors.isEmpty()) {
            throw problem(errors.get(0));
        }
        RenderedFile file = render(snapshot, entry, paths);
        if (file.bytes().length == 0 && file.diagnostics().stream()
                .anyMatch(d -> GenerationDiagnosticCodes.GEN_CHANNEL_MISSING.equals(d.code()))) {
            return notChecked(config, channel, locale, entry.pageNumber()); // the template writes nothing in the channel
        }

        GenerationTarget target = defaultTarget(projectId);
        String baseUrl = target == null ? "" : GenerationService.baseUrl(target);
        Set<RedirectFormat> formats = target == null ? RedirectFormat.DEFAULT : RedirectFormat.of(target.getConfig());
        OutputKey key = new OutputKey(
                entry.outputPath(), entry.pageUuid(), channel, locale, entry.pagination() == null ? null : entry.pageNumber());
        List<ReferenceEvent> events = EditorPaths.locate(file.references(), page.payload());
        CheckEnvironment environment = new CheckEnvironment(baseUrl, locales,
                outputs(snapshot, plan, locales, GenerationService.siteFiles(baseUrl, formats)), paths::settingsFor,
                QualityCheckStage.labels(snapshot), Map.of(key.path(), events), QualityCheckStage.noIndex(snapshot));

        PageRuleRunner.PageCheck checked = pageRules.check(key, file.bytes(), config, environment);
        List<Finding> findings = new ArrayList<>(checked.findings());
        if (checked.parsed() != null) {
            SiteIndex site = new SiteIndex(environment, Map.of(key.path(), checked.facts()), Set.of(),
                    Map.of(key.path(), events), Set.of());
            findings.addAll(siteRules.run(site, config, false, rule -> !NOT_RUN.contains(rule.code())));
            findings.addAll(siteRules.run(site, config, true, rule -> !NOT_RUN.contains(rule.code())));
            Map<UUID, String> editorPaths = EditorPaths.of(page.payload());
            findings.replaceAll(finding -> located(finding, checked.parsed(), environment, editorPaths, page.payload()));
        }
        List<String> skipped = config.registry().all().stream()
                .filter(config::enabled)
                .map(QualityRule::code)
                .filter(code -> NOT_RUN.contains(code) || RUN_IN_PART.contains(code))
                .toList();
        return new Result(channel, locale, entry.pageNumber(), findings, skipped);
    }

    /** No finding, every enabled rule skipped: the channel isn't HTML, or the page renders nothing in it. */
    private static Result notChecked(EffectiveQualityConfig config, String channel, String locale, int pageNumber) {
        List<String> all = config.registry().all().stream().filter(config::enabled).map(QualityRule::code).toList();
        return new Result(channel, locale, pageNumber, List.of(), all);
    }

    /** The declared spelling of {@code requested}; the default language for none; {@code null} without locales. */
    private static String locale(LocaleConfig locales, String requested) {
        if (!locales.isLocalized()) {
            return null;
        }
        if (requested == null || requested.isBlank()) {
            return locales.defaultLocale();
        }
        String declared = locales.canonicalDeclared(requested);
        if (declared == null) {
            throw new SfException(ProblemFactory.badRequest("Unknown language '" + requested + "'."));
        }
        return declared;
    }

    /** The plan entry of the page in the channel and language: the requested page number, clamped to the page count. */
    private static PlanEntry entry(BuildPlan plan, UUID page, String channel, String locale, Integer pageNumber) {
        List<PlanEntry> outputs = plan.siteOutputs().stream()
                .filter(entry -> entry.pageUuid().equals(page) && entry.channel().equals(channel)
                        && java.util.Objects.equals(entry.locale(), locale))
                .sorted(Comparator.comparingInt(PlanEntry::pageNumber))
                .toList();
        if (outputs.isEmpty()) {
            throw new SfException(ProblemFactory.notFound("Page not found."));
        }
        int number = Math.max(1, Math.min(pageNumber == null ? 1 : pageNumber, outputs.size()));
        return outputs.get(number - 1);
    }

    /** Renders the entry; a render limit fails the check with the limit's code, as it fails the page's preview. */
    private RenderedFile render(Snapshot snapshot, PlanEntry entry, OutputPathResolver paths) {
        try {
            return renderPipeline.renderForCheck(snapshot, entry, paths);
        } catch (RenderLimitException e) {
            Diagnostic diagnostic = e.diagnostic();
            throw diagnostic == null ? new SfException(ProblemFactory.unprocessableEntity(e.getMessage())) : problem(diagnostic);
        }
    }

    private static SfException problem(Diagnostic diagnostic) {
        return new SfException(ProblemFactory.other(422, diagnostic.code(), "Draft Check Failed", diagnostic.message()));
    }

    /** The target a build without an explicit one publishes to — whose base URL and site files links resolve against. */
    private GenerationTarget defaultTarget(long projectId) {
        return targets.findByProjectIdAndDefaultTargetTrue(projectId)
                .or(() -> targets.findByProjectId(projectId).stream().findFirst())
                .orElse(null);
    }

    /**
     * The draft's planned outputs, by path: every page output of every channel and language, every media file and variant
     * (in every language it is published for) and the target's site files.
     */
    private static Map<String, IndexedOutput> outputs(
            Snapshot snapshot, BuildPlan plan, LocaleConfig locales, Set<String> siteFiles) {
        Map<String, IndexedOutput> outputs = new LinkedHashMap<>();
        for (PlanEntry entry : plan.siteOutputs()) {
            OutputKey key = new OutputKey(entry.outputPath(), entry.pageUuid(), entry.channel(), entry.locale(),
                    entry.pagination() == null ? null : entry.pageNumber());
            outputs.putIfAbsent(key.path(), new IndexedOutput(key, BuildManifest.Kind.PAGE, false));
        }
        MediaOutputs media = new MediaOutputs(snapshot, locales);
        for (SnapshotAsset asset : snapshot.root().assetsOfType(AssetType.MEDIA)) {
            for (MediaOutputs.Output output : media.outputsOf(asset.uuid())) {
                List<String> files = new ArrayList<>();
                files.add(output.path());
                JsonNode variants = output.payload() == null ? null : output.payload().get("variants");
                if (variants != null && variants.isArray()) {
                    variants.forEach(variant -> {
                        String path = output.variantPath(variant.path("name").asText());
                        if (path != null) {
                            files.add(path);
                        }
                    });
                }
                for (String path : files) {
                    outputs.putIfAbsent(path, new IndexedOutput(new OutputKey(path, asset.uuid(), null,
                            output.key().locale(), null), BuildManifest.Kind.MEDIA, false));
                }
            }
        }
        for (String path : siteFiles) {
            outputs.putIfAbsent(path, new IndexedOutput(
                    new OutputKey(path, null, null, null, null), BuildManifest.Kind.SITE, false));
        }
        return outputs;
    }

    /**
     * {@code finding} located for the editor: a site rule's finding in the section instance of its element, an image
     * finding at the field that holds its media (best effort: when the image's {@code src} is a media file of the draft
     * that the page's content references), and a finding at a field of a body section in that section.
     */
    private static Finding located(
            Finding finding,
            ParsedOutput parsed,
            CheckEnvironment environment,
            Map<UUID, String> editorPaths,
            JsonNode payload) {
        Element element = element(parsed, finding.selector());
        Finding located = finding;
        if (located.sectionInstanceId() == null && element != null) {
            String section = parsed.sectionOf(element);
            if (section != null) {
                located = located.inSection(section);
            }
        }
        if (located.editorPath() == null && element != null && MEDIA_FINDINGS.contains(located.code())) {
            Element image = element.is("img, input") ? element : element.selectFirst("img[src]");
            String path = image == null ? null : mediaField(image.attr("src"), parsed, environment, editorPaths);
            if (path != null) {
                located = located.withEditorPath(path);
            }
        }
        if (located.sectionInstanceId() == null && located.editorPath() != null) {
            String section = sectionAt(payload, located.editorPath());
            if (section != null) {
                located = located.inSection(section);
            }
        }
        return located;
    }

    /** The instance id of the body section that holds field {@code editorPath} ({@code bodies.main[1]…}); else null. */
    private static String sectionAt(JsonNode payload, String editorPath) {
        Matcher matcher = SECTION_FIELD.matcher(editorPath);
        if (payload == null || !matcher.lookingAt()) {
            return null;
        }
        JsonNode section = payload.path("bodies").path(matcher.group(1)).path(Integer.parseInt(matcher.group(2)));
        String instanceId = section.path("instanceId").asText("");
        return instanceId.isBlank() ? null : instanceId;
    }

    /** The element {@code selector} names in the document; {@code null} for none or a whole-document finding. */
    private static Element element(ParsedOutput parsed, String selector) {
        if (selector == null || selector.isBlank()) {
            return null;
        }
        try {
            return parsed.document().selectFirst(selector);
        } catch (Selector.SelectorParseException e) {
            return null;
        }
    }

    /** The field of the page's content that references the media file {@code src} shows; {@code null} for none. */
    private static String mediaField(
            String src, ParsedOutput parsed, CheckEnvironment environment, Map<UUID, String> editorPaths) {
        if (src == null || src.isBlank()) {
            return null;
        }
        LinkResolver.Target target = environment.resolverFor(parsed.key().channel()).resolve(parsed.path(), src.strip());
        return environment.output(target == null ? null : target.path())
                .filter(output -> output.kind() == BuildManifest.Kind.MEDIA)
                .map(output -> editorPaths.get(output.key().asset()))
                .orElse(null);
    }
}
