package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.LocaleRelease;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.scheduler.ActionDescription;
import com.acme.staticforge.scheduler.ActionSpec;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.ExecutionOutcome;
import com.acme.staticforge.scheduler.PinPolicy;
import com.acme.staticforge.scheduler.ScheduleService;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.acme.staticforge.scheduler.actions.ReleaseActionHandler;
import com.acme.staticforge.scheduler.actions.ScheduleDrift;
import com.acme.staticforge.scheduler.actions.UnpublishActionHandler;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.generate.schedule.GenerationActionHandler;
import com.acme.staticforge.generate.schedule.RecurringGenerationActionHandler;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The scheduled action types (M27.4.2, M27.4.3): release (pinned and latest, per-item skips, one revision, re-runs,
 * "then generate" with a busy project, drift and re-pin), unpublish, and one-off and recurring generation (owner,
 * busy/skip/coalesce, idempotent re-runs, deleted target). Engines run on hand-moved clocks in 2025.
 */
@SpringBootTest
@ActiveProfiles("test")
class ScheduledActionsIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final Instant T = Instant.parse("2025-06-02T10:00:00Z");
    private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");
    private static final String CDL = "content { editor text title { label \"Title\" required } }";
    private static final String HTML = "<h1>$CMS_VALUE(title)$</h1>";

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-gen-scheduled");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired SchedulerFixtures fixtures;
    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired com.acme.staticforge.asset.AssetRepository assetRepository;
    @Autowired com.acme.staticforge.asset.AssetVersionRepository versionRepository;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired ReleaseStatusService statuses;
    @Autowired RevisionRepository revisions;
    @Autowired GenerationTargetRepository targets;
    @Autowired GenerationRunRepository runs;
    @Autowired GenerationService generationService;
    @Autowired ReleaseActionHandler releaseHandler;
    @Autowired UnpublishActionHandler unpublishHandler;
    @Autowired GenerationActionHandler generationHandler;
    @Autowired RecurringGenerationActionHandler recurringHandler;
    @Autowired ScheduleDrift drift;
    @Autowired ScheduleService scheduleService;

    private final ObjectMapper mapper = new ObjectMapper();
    private final List<Long> projects = new ArrayList<>();

    private record Fixture(Project project, AppUser owner, GenerationTarget target, TemplateView template) {
        long id() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), owner.getId(), "scheduled actions test");
        }
    }

    @AfterEach
    void retire() {
        projects.forEach(fixtures::retire);
    }

    // ------------------------------------------------------------------
    // RELEASE
    // ------------------------------------------------------------------

    @Test
    @DisplayName("pinned: a draft edited after scheduling stays a draft — the pinned version goes live, in one revision")
    void pinnedReleasesThePinnedVersion() {
        Fixture fx = fixture("sar-pin");
        UUID page = page(fx, "home", "v1");
        long pinnedVersion = openVersion(fx, page);
        ScheduledAction action = fixtures.oneOff(release(fx, PinPolicy.PINNED, null, page), T, fx.owner().getId());
        assertThat(action.getParams().path("items").get(0).path("pinnedVersionId").asLong()).isEqualTo(pinnedVersion);
        setTitle(fx, page, "v2");

        ActionDescription before = drift.forAction(ActionSpec.of(action));
        assertThat(before.driftCount()).isEqualTo(1);
        assertThat(before.items()).singleElement().satisfies(i -> {
            assertThat(i.draftChangedSinceScheduled()).isTrue();
            assertThat(i.uid()).isEqualTo("home");
            assertThat(i.status()).isEqualTo("NEW");
        });

        long releaseRevisions = revisionsOf(fx, ChangeType.RELEASE);
        run(fx, T.plusSeconds(1));

        ScheduledActionExecution execution = single(action);
        assertThat(execution.getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED);
        assertThat(execution.getMessage()).isEqualTo("1 released.");
        assertThat(revisionsOf(fx, ChangeType.RELEASE)).isEqualTo(releaseRevisions + 1);
        Revision revision = revisions.findByProjectIdAndRevisionId(fx.id(), execution.getRevisionId()).orElseThrow();
        assertThat(revision.getComment()).startsWith("Scheduled release #" + action.getId());
        assertThat(revision.getCreatedBy()).isEqualTo(fx.owner().getId());
        LocaleRelease released = statuses.ofAsset(fx.id(), page).get(ReleaseLocales.ALL);
        assertThat(released.releasedVersionId()).isEqualTo(pinnedVersion);
        assertThat(released.status()).isEqualTo(ReleaseStatus.CHANGED);
        assertThat(fixtures.reload(action.getId()).getStatus()).isEqualTo(ActionStatus.SUCCEEDED);
    }

    @Test
    @DisplayName("latest: the newest draft goes live; an incomplete item is skipped with its reason and the rest released (PARTIAL)")
    void latestSkipsIncompleteItems() {
        Fixture fx = fixture("sar-latest");
        UUID complete = page(fx, "complete", "v1");
        UUID incomplete = page(fx, "incomplete", "v1");
        ScheduledAction action = fixtures.oneOff(release(fx, PinPolicy.LATEST, null, complete, incomplete), T, fx.owner().getId());
        assertThat(action.getParams().path("items").get(0).has("pinnedVersionId")).isFalse();
        setTitle(fx, complete, "v2");
        setTitle(fx, incomplete, "");

        run(fx, T.plusSeconds(1));

        ScheduledActionExecution execution = single(action);
        assertThat(execution.getOutcome()).isEqualTo(ExecutionOutcome.PARTIAL);
        assertThat(execution.getMessage()).isEqualTo("1 released, 1 skipped.");
        JsonNode items = execution.getDetail().path("items");
        assertThat(items).hasSize(2);
        assertThat(items.get(0).path("result").asText()).isEqualTo("APPLIED");
        assertThat(items.get(1).path("result").asText()).isEqualTo("SKIPPED");
        assertThat(items.get(1).path("reason").asText()).startsWith("Content incomplete");
        assertThat(statuses.ofAsset(fx.id(), complete).get(ReleaseLocales.ALL).status()).isEqualTo(ReleaseStatus.PUBLISHED);
        assertThat(statuses.ofAsset(fx.id(), complete).get(ReleaseLocales.ALL).releasedVersionId())
                .isEqualTo(openVersion(fx, complete));
        assertThat(statuses.ofAsset(fx.id(), incomplete).get(ReleaseLocales.ALL).status()).isEqualTo(ReleaseStatus.NEW);
    }

    @Test
    @DisplayName("one revision for any number of items; re-executing after a lease expiry releases nothing twice")
    void oneRevisionAndIdempotentRerun() {
        Fixture fx = fixture("sar-once");
        UUID a = page(fx, "a", "A");
        UUID b = page(fx, "b", "B");
        UUID c = page(fx, "c", "C");
        ScheduledAction action = fixtures.oneOff(release(fx, PinPolicy.PINNED, null, a, b, c), T, fx.owner().getId());
        long before = revisionsOf(fx, ChangeType.RELEASE);
        MutableClock clock = new MutableClock(T.plusSeconds(1));
        SchedulerEngine engine = fixtures.engine("node-a", clock);
        try {
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            assertThat(revisionsOf(fx, ChangeType.RELEASE)).isEqualTo(before + 1);

            // A node that died after the release committed, before it recorded the end of the execution.
            fixtures.crashAfterFinishing(action.getId(), T.plusSeconds(2));
            clock.advance(Duration.ofMinutes(5));
            assertThat(fixtures.drain(engine)).isEqualTo(1);
        } finally {
            engine.close();
        }
        assertThat(revisionsOf(fx, ChangeType.RELEASE)).isEqualTo(before + 1);
        assertThat(fixtures.executions(action.getId())).singleElement().satisfies(e -> {
            assertThat(e.getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED);
            assertThat(e.getFinishedAt()).isNotNull();
        });
        // Releasing again what is already live changes nothing either.
        ScheduledAction again = fixtures.oneOff(release(fx, PinPolicy.LATEST, null, a), T, fx.owner().getId());
        run(fx, T.plusSeconds(1));
        assertThat(single(again).getMessage()).isEqualTo("0 released, 1 unchanged.");
        assertThat(single(again).getRevisionId()).isNull();
        assertThat(revisionsOf(fx, ChangeType.RELEASE)).isEqualTo(before + 1);
    }

    @Test
    @DisplayName("then generate waits for an active run, starts once it ended at the release revision, without releasing twice; unpublish removes the output")
    void thenGenerateAndUnpublish() throws Exception {
        Fixture fx = fixture("sar-then");
        UUID home = page(fx, "home", "Home");
        UUID news = page(fx, "news", "News");
        ScheduledAction action = fixtures.oneOff(release(fx, PinPolicy.PINNED, thenGenerate(fx), home, news), T, fx.owner().getId());
        GenerationRun blocker = runs.save(fakeRun(fx));
        long before = revisionsOf(fx, ChangeType.RELEASE);

        MutableClock clock = new MutableClock(T.plusSeconds(1));
        SchedulerEngine engine = fixtures.engine("node-a", clock);
        try {
            assertThat(fixtures.tickOnce(engine)).isEqualTo(1);
            ScheduledActionExecution waiting = single(action);
            assertThat(waiting.getFinishedAt()).isNull();
            assertThat(waiting.getMessage()).isEqualTo("2 released. Waiting for run #" + blocker.getId() + ".");
            assertThat(waiting.getDetail().path("waitingForRun").asLong()).isEqualTo(blocker.getId());
            assertThat(fixtures.reload(action.getId()).getStatus()).isEqualTo(ActionStatus.PENDING);
            assertThat(fixtures.reload(action.getId()).getNextRunAt()).isEqualTo(T);

            clock.advance(Duration.ofMinutes(1));
            assertThat(fixtures.tickOnce(engine)).isEqualTo(1);
            assertThat(single(action).getFinishedAt()).isNull();
            assertThat(revisionsOf(fx, ChangeType.RELEASE)).isEqualTo(before + 1);

            finish(blocker);
            clock.advance(Duration.ofMinutes(1));
            assertThat(fixtures.tickOnce(engine)).isEqualTo(1);
        } finally {
            engine.close();
        }
        ScheduledActionExecution done = single(action);
        assertThat(done.getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED);
        assertThat(done.getGenerationRunId()).isNotNull();
        assertThat(done.getMessage()).isEqualTo("2 released. Generation run #" + done.getGenerationRunId() + " started.");
        assertThat(revisionsOf(fx, ChangeType.RELEASE)).isEqualTo(before + 1);
        GenerationRun run = await(fx, done.getGenerationRunId());
        assertThat(run.getMode()).isEqualTo(GenerationMode.INCREMENTAL);
        assertThat(run.getRevisionId()).isEqualTo(done.getRevisionId());
        assertThat(run.getStartedBy()).isEqualTo(fx.owner().getId());
        assertThat(run.getTargetId()).isEqualTo(fx.target().getId());
        assertThat(run.getComment()).isEqualTo("After scheduled release #" + action.getId());
        assertThat(files(fx, run)).containsKeys("home.html", "news.html");

        // Unpublish at T, then generate: the page's output is gone from the new build.
        ActionSpec unpublish = unpublishHandler.validate(new ActionSpec(fx.id(), null, UnpublishActionHandler.TYPE,
                items(List.of(news), "items"), null, thenGenerate(fx), false), fx.owner().getId());
        ScheduledAction off = fixtures.oneOff(unpublish, T, fx.owner().getId());
        run(fx, T.plusSeconds(1));
        ScheduledActionExecution offDone = single(off);
        assertThat(offDone.getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED);
        assertThat(offDone.getMessage()).startsWith("1 unpublished. Generation run #");
        assertThat(revisions.findByProjectIdAndRevisionId(fx.id(), offDone.getRevisionId()).orElseThrow().getChangeType())
                .isEqualTo(ChangeType.UNPUBLISH);
        Map<String, String> after = files(fx, await(fx, offDone.getGenerationRunId()));
        assertThat(after).containsKey("home.html").doesNotContainKey("news.html");
        assertThat(statuses.ofAsset(fx.id(), news).get(ReleaseLocales.ALL).status()).isEqualTo(ReleaseStatus.UNPUBLISHED);
    }

    @Test
    @DisplayName("re-pin moves every pinned item to the current draft and clears the drift")
    void repinClearsDrift() {
        Fixture fx = fixture("sar-repin");
        UUID page = page(fx, "home", "v1");
        ScheduledAction action = scheduleService.create(fx.id(), new ScheduleService.Command(
                ReleaseActionHandler.TYPE, Instant.now().plus(Duration.ofDays(1)), null, null, PinPolicy.PINNED, null, null,
                null, items(List.of(page), "items")), fx.owner().getId());
        setTitle(fx, page, "v2");
        assertThat(scheduleService.detail(fx.id(), action.getId()).description().driftCount()).isEqualTo(1);

        scheduleService.repin(fx.id(), action.getId(), fx.owner().getId());

        ScheduleService.Summary after = scheduleService.detail(fx.id(), action.getId());
        assertThat(after.description().driftCount()).isZero();
        assertThat(after.description().items()).singleElement()
                .satisfies(i -> assertThat(i.pinnedVersionId()).isEqualTo(openVersion(fx, page)));
    }

    // ------------------------------------------------------------------
    // GENERATION / RECURRING_GENERATION
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a one-off full build starts one run as the owner and links it; re-running the slot starts no second run")
    void oneOffGeneration() throws Exception {
        Fixture fx = fixture("sgen-once");
        page(fx, "home", "Home");
        fixtures.oneOff(release(fx, PinPolicy.LATEST, null, pages(fx)), T, fx.owner().getId());
        run(fx, T.plusSeconds(1));
        ScheduledAction build = fixtures.oneOff(generation(fx, GenerationActionHandler.TYPE, "FULL"), T, fx.owner().getId());
        int runsBefore = runsOf(fx);

        MutableClock clock = new MutableClock(T.plusSeconds(1));
        SchedulerEngine engine = fixtures.engine("node-a", clock);
        try {
            assertThat(fixtures.drain(engine)).isEqualTo(1);
            ScheduledActionExecution execution = single(build);
            assertThat(execution.getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED);
            GenerationRun run = await(fx, execution.getGenerationRunId());
            assertThat(run.getStartedBy()).isEqualTo(fx.owner().getId());
            assertThat(run.getMode()).isEqualTo(GenerationMode.FULL);
            // The run keeps the schedule's note, so the generation history says where it came from.
            assertThat(run.getComment()).isEqualTo("Scheduled generation #" + build.getId() + ": nightly");
            assertThat(files(fx, run)).containsKey("home.html");

            fixtures.crashAfterFinishing(build.getId(), T.plusSeconds(2));
            clock.advance(Duration.ofMinutes(5));
            assertThat(fixtures.drain(engine)).isEqualTo(1);
        } finally {
            engine.close();
        }
        assertThat(runsOf(fx)).isEqualTo(runsBefore + 1);
        assertThat(fixtures.executions(build.getId())).singleElement()
                .satisfies(e -> assertThat(e.getFinishedAt()).isNotNull());
    }

    @Test
    @DisplayName("recurring 0 0 3 * * * in Europe/Berlin starts one run per day at 03:00 local across the DST switch")
    void recurringGenerationAcrossDst() throws Exception {
        Fixture fx = fixture("sgen-daily");
        page(fx, "home", "Home");
        fixtures.oneOff(release(fx, PinPolicy.LATEST, null, pages(fx)), T, fx.owner().getId());
        run(fx, T.plusSeconds(1));
        ActionSpec spec = generation(fx, RecurringGenerationActionHandler.TYPE, "INCREMENTAL");
        ScheduledAction daily = fixtures.recurring(fx.id(), spec.type(), spec.params(), "0 0 3 * * *", BERLIN.getId(),
                LocalDateTime.of(2025, 3, 29, 12, 0).atZone(BERLIN).toInstant(), fx.owner().getId());

        List<Instant> slots = List.of(
                Instant.parse("2025-03-30T01:00:00Z"), Instant.parse("2025-03-31T01:00:00Z"), Instant.parse("2025-04-01T01:00:00Z"));
        MutableClock clock = new MutableClock(slots.get(0).minusSeconds(1));
        SchedulerEngine engine = fixtures.engine("node-a", clock);
        try {
            assertThat(fixtures.drain(engine)).isZero();
            for (Instant slot : slots) {
                clock.set(slot.plusSeconds(2));
                assertThat(fixtures.drain(engine)).isEqualTo(1);
                ScheduledActionExecution last = fixtures.executions(daily.getId()).get(fixtures.executions(daily.getId()).size() - 1);
                await(fx, last.getGenerationRunId());
            }
        } finally {
            engine.close();
        }
        List<ScheduledActionExecution> executions = fixtures.executions(daily.getId());
        assertThat(executions).extracting(ScheduledActionExecution::getScheduledFor).containsExactlyElementsOf(slots);
        assertThat(executions).extracting(e -> e.getScheduledFor().atZone(BERLIN).getHour()).containsOnly(3);
        assertThat(executions).allSatisfy(e -> assertThat(e.getGenerationRunId()).isNotNull());
        assertThat(executions).extracting(ScheduledActionExecution::getGenerationRunId).doesNotHaveDuplicates();
        assertThat(fixtures.reload(daily.getId()).getNextRunAt()).isEqualTo(Instant.parse("2025-04-02T01:00:00Z"));
    }

    @Test
    @DisplayName("busy project: RUN_LATE starts right after the run ends; SKIP_IF_LATER_THAN 15m skips a 30-minute wait; recurring slots coalesce")
    void busyProject() throws Exception {
        Fixture fx = fixture("sgen-busy");
        page(fx, "home", "Home");
        fixtures.oneOff(release(fx, PinPolicy.LATEST, null, pages(fx)), T, fx.owner().getId());
        run(fx, T.plusSeconds(1));
        ActionSpec spec = generation(fx, GenerationActionHandler.TYPE, "FULL");
        ScheduledAction late = fixtures.oneOff(spec, T, fx.owner().getId());
        ScheduledAction bounded = fixtures.skipIfLaterThan(fixtures.oneOff(spec, T, fx.owner().getId()), Duration.ofMinutes(15));
        ScheduledAction hourly = fixtures.recurring(fx.id(), RecurringGenerationActionHandler.TYPE, spec.params(),
                "0 0 * * * *", "UTC", T.minusSeconds(1), fx.owner().getId());
        GenerationRun blocker = runs.save(fakeRun(fx));

        MutableClock clock = new MutableClock(T.plusSeconds(1));
        SchedulerEngine engine = fixtures.engine("node-a", clock);
        try {
            assertThat(fixtures.tickOnce(engine)).isEqualTo(3);
            for (ScheduledAction action : List.of(late, bounded, hourly)) {
                assertThat(single(action).getMessage()).isEqualTo("Waiting for run #" + blocker.getId() + ".");
                assertThat(single(action).getFinishedAt()).isNull();
            }
            // 31 minutes later — past the bound, and the hourly slot of 11:00 is due too.
            clock.set(T.plus(Duration.ofMinutes(61)));
            assertThat(fixtures.tickOnce(engine)).isEqualTo(3);
            assertThat(single(bounded).getOutcome()).isEqualTo(ExecutionOutcome.SKIPPED);
            assertThat(single(bounded).getMessage()).contains("still active past the limit");
            assertThat(fixtures.reload(bounded.getId()).getStatus()).isEqualTo(ActionStatus.SKIPPED);
            assertThat(fixtures.executions(hourly.getId())).as("one open execution for both slots").hasSize(1);

            finish(blocker);
            clock.advance(Duration.ofSeconds(30));
            assertThat(fixtures.tickOnce(engine)).isEqualTo(2);
            // Both are due in the same tick, but a project has one run at a time (epic decision 27): whichever starts
            // first, the other meets its run and waits, then starts on a tick after that run has ended.
            for (int round = 0; round < 10 && (runOf(late) == null || runOf(hourly) == null); round++) {
                for (Long runId : Arrays.asList(runOf(late), runOf(hourly))) {
                    if (runId != null) {
                        await(fx, runId);
                    }
                }
                clock.advance(Duration.ofSeconds(15));
                fixtures.tickOnce(engine);
            }
            assertThat(runOf(late)).as("the one-off started").isNotNull();
            assertThat(runOf(hourly)).as("the coalesced hourly slot started").isNotNull();
            await(fx, runOf(late));
            await(fx, runOf(hourly));
        } finally {
            engine.close();
        }
        assertThat(single(late).getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED);
        assertThat(single(late).getLateByMs()).isEqualTo(1000);
        ScheduledActionExecution coalesced = single(hourly);
        assertThat(coalesced.getOutcome()).isEqualTo(ExecutionOutcome.SUCCEEDED);
        assertThat(coalesced.getGenerationRunId()).isNotNull().isNotEqualTo(single(late).getGenerationRunId());
        assertThat(coalesced.getScheduledFor()).isEqualTo(T);
        assertThat(fixtures.reload(hourly.getId()).getNextRunAt()).isEqualTo(T.plus(Duration.ofHours(2)));
    }

    @Test
    @DisplayName("a deleted target fails the execution with SF-DOM-0162 and pauses the recurring action")
    void deletedTarget() {
        Fixture fx = fixture("sgen-gone");
        page(fx, "home", "Home");
        ActionSpec spec = generation(fx, RecurringGenerationActionHandler.TYPE, "FULL");
        GenerationTarget extra = targets.save(new GenerationTarget(fx.id(), "extra", TargetType.FILESYSTEM, config(), false));
        ObjectNode params = spec.params().deepCopy();
        params.put("targetId", extra.getId());
        ScheduledAction hourly = fixtures.recurring(fx.id(), spec.type(), params, "0 0 * * * *", "UTC", T.minusSeconds(1),
                fx.owner().getId());
        targets.delete(extra);

        run(fx, T.plusSeconds(1));

        ScheduledAction after = fixtures.reload(hourly.getId());
        assertThat(after.getStatus()).isEqualTo(ActionStatus.FAILED);
        assertThat(after.getNextRunAt()).isNull();
        assertThat(single(hourly).getDetail().path("code").asText()).isEqualTo("SF-DOM-0162");
        assertThat(single(hourly).getMessage()).isEqualTo("Generation target " + extra.getId() + " doesn't exist.");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(prefix + n + "-admin", prefix + n + "-admin@example.com", "Admin", "secret-password");
        AppUser owner = userService.create(prefix + n + "-owner", prefix + n + "-owner@example.com", "Owner", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix.replace("-", "") + n, prefix + n, null, "scheduled actions"), admin.getId());
        projectService.setMemberRole(project.getKey(), owner.getId(), ProjectRole.DEVELOPER,
                RevisionContext.of(project.getId(), admin.getId(), "member"));
        GenerationTarget target = targets.save(new GenerationTarget(project.getId(), "default", TargetType.FILESYSTEM, config(), true));
        RevisionContext ctx = RevisionContext.of(project.getId(), owner.getId(), "fixture");
        TemplateView template = templateService.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page",
                CdlSources.split(CDL), Map.of("html", HTML), null, false, Map.of("html", "{folder}{uid}.{ext}")), ctx);
        projects.add(project.getId());
        return new Fixture(project, owner, target, template);
    }

    private JsonNode config() {
        try {
            return mapper.readTree("{\"baseUrl\":\"https://example.com\"}");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private UUID page(Fixture fx, String name, String title) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx());
        setTitle(fx, page.uuid(), title);
        return page.uuid();
    }

    private UUID[] pages(Fixture fx) {
        return assetService.search(new com.acme.staticforge.asset.AssetQuery(fx.id(), AssetType.PAGE, null, null),
                        org.springframework.data.domain.PageRequest.of(0, 100))
                .getContent().stream().map(com.acme.staticforge.asset.AssetSummary::uuid).toArray(UUID[]::new);
    }

    private void setTitle(Fixture fx, UUID page, String title) {
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", title);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private long openVersion(Fixture fx, UUID page) {
        long assetId = assetRepository.findByProjectIdAndUuid(fx.id(), page).orElseThrow().getId();
        return versionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).orElseThrow().getId();
    }

    private ObjectNode items(List<UUID> uuids, String field) {
        ObjectNode params = mapper.createObjectNode();
        ArrayNode items = params.putArray(field);
        uuids.forEach(u -> items.addObject().put("assetUuid", u.toString()));
        return params;
    }

    private ActionSpec release(Fixture fx, PinPolicy pin, JsonNode thenGenerate, UUID... uuids) {
        return releaseHandler.validate(new ActionSpec(fx.id(), null, ReleaseActionHandler.TYPE,
                items(List.of(uuids), "items"), pin, thenGenerate, false), fx.owner().getId());
    }

    private ObjectNode thenGenerate(Fixture fx) {
        ObjectNode then = mapper.createObjectNode();
        then.put("targetId", fx.target().getId());
        then.putArray("channels").add("html");
        return then;
    }

    private ActionSpec generation(Fixture fx, String type, String mode) {
        ObjectNode params = mapper.createObjectNode();
        params.put("mode", mode);
        params.putArray("channels").add("html");
        params.put("targetId", fx.target().getId());
        params.put("comment", "nightly");
        boolean recurring = type.equals(RecurringGenerationActionHandler.TYPE);
        ActionSpec draft = new ActionSpec(fx.id(), null, type, params, null, null, recurring);
        return recurring ? recurringHandler.validate(draft, fx.owner().getId()) : generationHandler.validate(draft, fx.owner().getId());
    }

    private GenerationRun fakeRun(Fixture fx) {
        return new GenerationRun(fx.id(), null, GenerationMode.FULL, null, fx.target().getId(), RunStatus.RUNNING,
                Instant.now(), null, fx.owner().getId(), 0, 0, 0, 0, 0, null, null);
    }

    private void finish(GenerationRun run) {
        GenerationRun stored = runs.findById(run.getId()).orElseThrow();
        stored.setStatus(RunStatus.SUCCESS);
        stored.setFinishedAt(Instant.now());
        runs.save(stored);
    }

    /** Ticks a fresh engine at {@code at} until nothing is due. */
    private void run(Fixture fx, Instant at) {
        SchedulerEngine engine = fixtures.engine("node-run", new MutableClock(at));
        try {
            fixtures.drain(engine);
        } finally {
            engine.close();
        }
    }

    /** The generation run the single execution of {@code action} started, or {@code null} while it hasn't. */
    private Long runOf(ScheduledAction action) {
        return single(action).getGenerationRunId();
    }

    private ScheduledActionExecution single(ScheduledAction action) {
        List<ScheduledActionExecution> executions = fixtures.executions(action.getId());
        assertThat(executions).hasSize(1);
        return executions.get(0);
    }

    private long revisionsOf(Fixture fx, ChangeType type) {
        return revisions.findByProjectIdOrderByRevisionIdDesc(fx.id()).stream().filter(r -> r.getChangeType() == type).count();
    }

    private int runsOf(Fixture fx) {
        return runs.findByProjectIdOrderByIdDesc(fx.id()).size();
    }

    private GenerationRun await(Fixture fx, long runId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 60_000;
        while (System.currentTimeMillis() < deadline) {
            GenerationRun run = generationService.status(fx.project().getKey(), runId);
            if (run.getStatus().isTerminal()) {
                assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isIn(RunStatus.SUCCESS, RunStatus.PARTIAL);
                return run;
            }
            Thread.sleep(50);
        }
        throw new AssertionError("Generation did not finish within 60s");
    }

    private Map<String, String> files(Fixture fx, GenerationRun run) throws IOException {
        Path dir = TargetLocations.resolve(outputRoot, fx.project().getKey(), fx.target())
                .resolve("builds")
                .resolve(String.valueOf(run.getId()));
        Map<String, String> files = new TreeMap<>();
        try (Stream<Path> stream = Files.walk(dir)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                files.put(dir.relativize(file).toString().replace('\\', '/'), Files.readString(file));
            }
        }
        return files;
    }
}
