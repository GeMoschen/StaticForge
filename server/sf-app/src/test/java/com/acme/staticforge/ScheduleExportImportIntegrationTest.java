package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.exportimport.ConflictReport;
import com.acme.staticforge.exportimport.ConflictType;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ImportConflict;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ImportResult;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.exportimport.ReleaseMode;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.MissedPolicy;
import com.acme.staticforge.scheduler.PinPolicy;
import com.acme.staticforge.scheduler.ScheduleService;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Export/import protocol 9 (M27.8.1): archives carry a project's open schedules — pins by content, generation targets
 * by uuid, owners by username — and an import brings them in, replacing open schedules with the same identity. What
 * can't be imported as it is (overdue, target missing, failing a create's checks, shadowed by an executing or finished
 * schedule) is left out with a warning while the rest of the import commits.
 */
@SpringBootTest
@ActiveProfiles("test")
class ScheduleExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" required } }";
    private static final String LOCALIZED_CDL = "content { editor text title { label \"Title\" localizable } }";

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired AssetVersionRepository versionRepository;
    @Autowired PageService pageService;
    @Autowired TemplateService templateService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired ReleaseService releaseService;
    @Autowired ReleaseStatusService releaseStatusService;
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired ScheduleService scheduleService;
    @Autowired ScheduledActionRepository actionRepository;
    @Autowired SchedulerFixtures schedulerFixtures;
    @Autowired AuditService audit;
    @Autowired ProjectExportImportService exportImportService;

    private final ObjectMapper mapper = new ObjectMapper();
    private final List<Long> projects = new ArrayList<>();

    /** A project, its admin (who imports), a developer who owns schedules, its template and its target (or none). */
    private record Fixture(Project project, AppUser admin, AppUser owner, TemplateView template, GenerationTarget target) {

        long id() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), owner.getId(), "schedule export/import");
        }

        RevisionContext importCtx() {
            return RevisionContext.of(project.getId(), admin.getId(), "import");
        }
    }

    @AfterEach
    void retire() {
        projects.forEach(schedulerFixtures::retire);
    }

    // ------------------------------------------------------------------
    // Round trips
    // ------------------------------------------------------------------

    @Test
    @DisplayName("pinned release: a pin on the draft pins the imported draft, an older pin its content; target by uuid; no database ids")
    void pinnedReleaseRoundTrip() throws Exception {
        Fixture src = fixture("sxa", "Production", false);
        UUID one = page(src, "one", "One v1");
        UUID two = page(src, "two", "Two v1");
        Instant runAt = inTwoDays();
        ScheduledAction action = scheduleService.create(src.id(), new ScheduleService.Command(
                "RELEASE", runAt, null, "Europe/Berlin", PinPolicy.PINNED, MissedPolicy.SKIP_IF_LATER_THAN,
                Duration.ofHours(1), thenGenerate(src.target().getId()), items(List.of(one, two), "launch")),
                src.owner().getId());
        setTitle(src, two, "Two v2");

        byte[] archive = exportImportService.exportProject(src.id());
        String json = entry(archive, "schedules/" + action.getUuid() + ".json");
        assertThat(json).doesNotContain("pinnedVersionId", "targetId", "ownerUserId", "\"id\"");
        JsonNode exported = mapper.readTree(json);
        assertThat(exported.path("ownerUsername").asText()).isEqualTo(src.owner().getUsername());
        assertThat(exported.path("thenGenerate").path("target").path("uuid").asText())
                .isEqualTo(src.target().getUuid().toString());
        assertThat(item(exported, one).path("pin").path("state").asText()).isEqualTo("DRAFT_EQUALS");
        assertThat(item(exported, two).path("pin").path("state").asText()).isEqualTo("PAYLOAD");
        assertThat(item(exported, two).path("pin").path("payload").path("content").path("title").asText()).isEqualTo("Two v1");

        Fixture dst = fixture("sxb", null, false);
        ImportResult result = exportImportService.importProject(dst.id(), archive, dst.importCtx(), ImportOptions.DEFAULT);

        assertThat(result.importedScheduleCount()).isEqualTo(1);
        assertThat(result.scheduleWarnings()).extracting(ImportConflict::type)
                .containsExactly(ConflictType.SCHEDULE_OWNER_REPLACED);
        ScheduledAction imported = actionRepository.findByProjectIdAndUuid(dst.id(), action.getUuid()).orElseThrow();
        assertThat(imported.getStatus()).isEqualTo(ActionStatus.PENDING);
        assertThat(imported.getRunAt()).isEqualTo(runAt);
        assertThat(imported.getNextRunAt()).isEqualTo(runAt);
        assertThat(imported.getZoneId()).isEqualTo("Europe/Berlin");
        assertThat(imported.getPinPolicy()).isEqualTo(PinPolicy.PINNED);
        assertThat(imported.getMissedPolicy()).isEqualTo(MissedPolicy.SKIP_IF_LATER_THAN);
        assertThat(imported.getMaxLateness()).isEqualTo(Duration.ofHours(1));
        assertThat(imported.getParams().path("comment").asText()).isEqualTo("launch");
        assertThat(imported.getOwnerUserId()).as("the owner isn't a member here").isEqualTo(dst.admin().getId());
        assertThat(imported.getCreatedBy()).isEqualTo(src.owner().getId());
        assertThat(imported.getCreatedAt()).isEqualTo(schedulerFixtures.reload(action.getId()).getCreatedAt());
        GenerationTarget importedTarget = targetRepository.findByProjectId(dst.id()).stream()
                .filter(t -> t.getUuid().equals(src.target().getUuid()))
                .findFirst().orElseThrow();
        assertThat(imported.getThenGenerate().path("targetId").asLong()).isEqualTo(importedTarget.getId());

        assertThat(pinOf(imported, one)).isEqualTo(openVersion(dst, one));
        long pinnedTwo = pinOf(imported, two);
        AssetVersion pinned = versionRepository.findById(pinnedTwo).orElseThrow();
        assertThat(pinnedTwo).isNotEqualTo(openVersion(dst, two));
        assertThat(pinned.getValidToRevision()).isEqualTo(pinned.getValidFromRevision());
        assertThat(pinned.getPayload().path("content").path("title").asText()).isEqualTo("Two v1");
        assertThat(scheduleService.detail(dst.id(), imported.getId()).description().driftCount()).isEqualTo(1);

        // Executing the release makes the pinned content live, like a pinned release does.
        releaseService.release(List.of(new ReleaseItem(two, ReleaseLocales.ALL, pinnedTwo)), dst.ctx());
        assertThat(releaseStatusService.ofAsset(dst.id(), two).get(ReleaseLocales.ALL).releasedVersionId()).isEqualTo(pinnedTwo);

        assertThat(audit.findRecent(dst.id(), PageRequest.of(0, 50)))
                .filteredOn(log -> log.getAction().equals("SCHEDULE_IMPORTED"))
                .singleElement()
                .satisfies(log -> {
                    assertThat(log.getActorUserId()).isEqualTo(dst.admin().getId());
                    assertThat(log.getTarget()).isEqualTo("schedule:" + imported.getId());
                });
    }

    @Test
    @DisplayName("latest, unpublish, one-off and recurring generations keep their owner, timing and status; a paused one stays paused")
    void otherTypesRoundTrip() throws Exception {
        Fixture src = fixture("sxc", "Production", false);
        UUID one = page(src, "one", "One v1");
        UUID two = page(src, "two", "Two v1");
        releaseFixtures.releaseAll(src.id());
        Instant runAt = inTwoDays();
        ScheduledAction latest = scheduleService.create(src.id(), new ScheduleService.Command(
                "RELEASE", runAt, null, null, PinPolicy.LATEST, null, null, null, items(List.of(one), null)),
                src.owner().getId());
        ScheduledAction unpublish = scheduleService.create(src.id(), new ScheduleService.Command(
                "UNPUBLISH", runAt, null, null, null, null, null, thenGenerate(null), items(List.of(two), null)),
                src.owner().getId());
        ScheduledAction generation = scheduleService.create(src.id(), new ScheduleService.Command(
                "GENERATION", runAt, null, null, null, null, null, null, generation("FULL", null)),
                src.owner().getId());
        ScheduledAction recurring = scheduleService.create(src.id(), new ScheduleService.Command(
                "RECURRING_GENERATION", null, "0 0 3 * * *", "Europe/Berlin", null, null, null, null,
                generation("INCREMENTAL", src.target().getId())), src.owner().getId());
        ScheduledAction paused = scheduleService.create(src.id(), new ScheduleService.Command(
                "RECURRING_GENERATION", null, "0 30 4 * * *", "Europe/Berlin", null, null, null, null,
                generation("FULL", null)), src.owner().getId());
        paused.setStatus(ActionStatus.FAILED);
        paused.setNextRunAt(null);
        schedulerFixtures.save(paused);

        Fixture dst = fixture("sxd", null, false);
        projectService.setMemberRole(dst.project().getKey(), src.owner().getId(), ProjectRole.DEVELOPER,
                RevisionContext.of(dst.id(), dst.admin().getId(), "member"));
        ImportResult result = exportImportService.importProject(
                dst.id(), exportImportService.exportProject(src.id()), dst.importCtx(), ImportOptions.DEFAULT);

        assertThat(result.importedScheduleCount()).isEqualTo(5);
        assertThat(result.scheduleWarnings()).isEmpty();
        ScheduledAction importedLatest = imported(dst, latest);
        assertThat(importedLatest.getPinPolicy()).isEqualTo(PinPolicy.LATEST);
        assertThat(importedLatest.getParams().path("items").get(0).has("pinnedVersionId")).isFalse();
        assertThat(importedLatest.getOwnerUserId()).isEqualTo(src.owner().getId());
        ScheduledAction importedUnpublish = imported(dst, unpublish);
        assertThat(importedUnpublish.getParams().path("items").get(0).path("assetUuid").asText()).isEqualTo(two.toString());
        assertThat(importedUnpublish.getThenGenerate().path("targetId").isNull()).isTrue();
        assertThat(imported(dst, generation).getParams().path("targetId").isNull()).isTrue();
        assertThat(imported(dst, generation).getRunAt()).isEqualTo(runAt);
        ScheduledAction importedRecurring = imported(dst, recurring);
        assertThat(importedRecurring.getStatus()).isEqualTo(ActionStatus.PENDING);
        assertThat(importedRecurring.getCron()).isEqualTo(recurring.getCron());
        assertThat(importedRecurring.getNextRunAt()).isEqualTo(recurring.getNextRunAt());
        assertThat(importedRecurring.getParams().path("mode").asText()).isEqualTo("INCREMENTAL");
        assertThat(importedRecurring.getParams().path("targetId").asLong())
                .isEqualTo(targetRepository.findByProjectId(dst.id()).get(0).getId());
        ScheduledAction importedPaused = imported(dst, paused);
        assertThat(importedPaused.getStatus()).isEqualTo(ActionStatus.FAILED);
        assertThat(importedPaused.getNextRunAt()).isNull();
        assertThat(scheduleService.scheduledFor(dst.id(), List.of(one, two)))
                .as("the imported schedules touch their pages")
                .containsOnlyKeys(one, two);
    }

    @Test
    @DisplayName("re-import replaces open schedules in place and leaves executing and finished ones alone")
    void reimportReplacesOpenSchedules() throws Exception {
        Fixture fx = fixture("sxe", "Production", false);
        UUID one = page(fx, "one", "One v1");
        Instant runAt = inTwoDays();
        ScheduledAction release = scheduleService.create(fx.id(), new ScheduleService.Command(
                "RELEASE", runAt, null, null, PinPolicy.PINNED, null, null, null, items(List.of(one), null)),
                fx.owner().getId());
        ScheduledAction recurring = scheduleService.create(fx.id(), new ScheduleService.Command(
                "RECURRING_GENERATION", null, "0 0 3 * * *", "UTC", null, null, null, null, generation("FULL", null)),
                fx.owner().getId());
        ScheduledAction oneOff = scheduleService.create(fx.id(), new ScheduleService.Command(
                "GENERATION", runAt, null, null, null, null, null, null, generation("FULL", null)), fx.owner().getId());
        byte[] archive = exportImportService.exportProject(fx.id());

        ConflictReport analysis = exportImportService.analyzeImport(fx.id(), archive, ImportOptions.DEFAULT);
        assertThat(analysis.scheduleCount()).isEqualTo(3);
        assertThat(analysis.conflicts()).filteredOn(c -> c.type() == ConflictType.DUPLICATE_SCHEDULE).hasSize(3)
                .allSatisfy(c -> assertThat(c.detail()).startsWith("Replaces schedule #"));
        ImportResult first = exportImportService.importProject(fx.id(), archive, fx.importCtx(), ImportOptions.DEFAULT);
        assertThat(first.importedScheduleCount()).isZero();
        assertThat(first.updatedScheduleCount()).isEqualTo(3);
        ScheduledAction replaced = schedulerFixtures.reload(release.getId());
        assertThat(replaced.getVersion()).isGreaterThan(release.getVersion());
        assertThat(pinOf(replaced, one)).as("pins the draft the import wrote").isEqualTo(openVersion(fx, one));
        assertThat(actionRepository.findAll()).filteredOn(a -> a.getProjectId().equals(fx.id())).hasSize(3);

        scheduleService.cancel(fx.id(), oneOff.getId(), fx.owner().getId());
        schedulerFixtures.crash(recurring.getId(), "node-x", Instant.now().plus(Duration.ofMinutes(5)));
        ImportResult second = exportImportService.importProject(fx.id(), archive, fx.importCtx(), ImportOptions.DEFAULT);

        assertThat(second.updatedScheduleCount()).isEqualTo(1);
        assertThat(details(second.scheduleWarnings(), ConflictType.DUPLICATE_SCHEDULE)).containsExactlyInAnyOrder(
                "Replaced schedule #" + release.getId() + ", which had the same identity.",
                "Not imported: schedule #" + recurring.getId() + " has the same identity and is executing.",
                "Not imported: schedule #" + oneOff.getId() + " has the same identity and has finished (CANCELLED).");
        assertThat(schedulerFixtures.reload(oneOff.getId()).getStatus()).isEqualTo(ActionStatus.CANCELLED);
        assertThat(schedulerFixtures.reload(recurring.getId()).getStatus()).isEqualTo(ActionStatus.RUNNING);
    }

    // ------------------------------------------------------------------
    // What is left out
    // ------------------------------------------------------------------

    @Test
    @DisplayName("overdue, target missing and invalid schedules are left out with a warning; a name-clash target resolves by name; the rest commits")
    void unimportableSchedulesAreLeftOut() throws Exception {
        Fixture src = fixture("sxf", "Production", false);
        UUID kept = page(src, "kept", "Kept v1");
        UUID doomed = page(src, "doomed", "Doomed v1");
        releaseFixtures.releaseAll(src.id());
        assetService.softDelete(doomed, true, src.ctx());
        Instant runAt = inTwoDays();
        GenerationTarget gone = targetRepository.save(new GenerationTarget(src.id(), "Gone", TargetType.FILESYSTEM, config(), false));

        ScheduledAction overdue = schedulerFixtures.oneOff(src.id(), "GENERATION", generation("FULL", null),
                Instant.now().minus(Duration.ofHours(1)), src.owner().getId());
        ScheduledAction targetGone = scheduleService.create(src.id(), new ScheduleService.Command(
                "GENERATION", runAt, null, null, null, null, null, null, generation("FULL", gone.getId())), src.owner().getId());
        targetRepository.delete(gone);
        ScheduledAction deletion = scheduleService.create(src.id(), new ScheduleService.Command(
                "RELEASE", runAt, null, null, PinPolicy.PINNED, null, null, null, items(List.of(doomed), null)),
                src.owner().getId());
        assertThat(deletion.getParams().path("items").get(0).path("deletion").asBoolean()).isTrue();
        ScheduledAction clash = scheduleService.create(src.id(), new ScheduleService.Command(
                "GENERATION", runAt, null, null, null, null, null, null, generation("FULL", src.target().getId())),
                src.owner().getId());
        ScheduledAction fine = scheduleService.create(src.id(), new ScheduleService.Command(
                "RELEASE", runAt, null, null, PinPolicy.LATEST, null, null, null, items(List.of(kept), null)),
                src.owner().getId());
        byte[] archive = exportImportService.exportProject(src.id());

        // The target has its own "Production" target: the archive's is skipped for the name clash, and the schedule
        // that builds to it builds to the target's instead.
        Fixture dst = fixture("sxg", "Production", false);
        projectService.setMemberRole(dst.project().getKey(), src.owner().getId(), ProjectRole.DEVELOPER,
                RevisionContext.of(dst.id(), dst.admin().getId(), "member"));
        ImportOptions asDraft = new ImportOptions(false, ReleaseMode.DRAFT, true);
        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), archive, asDraft);
        assertThat(typesByUuid(analysis.conflicts())).containsExactlyInAnyOrderEntriesOf(Map.of(
                overdue.getUuid().toString(), ConflictType.SCHEDULE_OVERDUE,
                targetGone.getUuid().toString(), ConflictType.SCHEDULE_TARGET_MISSING,
                deletion.getUuid().toString(), ConflictType.SCHEDULE_INVALID));

        ImportResult result = exportImportService.importProject(dst.id(), archive, dst.importCtx(), asDraft);

        assertThat(result.importedScheduleCount()).isEqualTo(2);
        assertThat(typesByUuid(result.scheduleWarnings())).containsExactlyInAnyOrderEntriesOf(Map.of(
                overdue.getUuid().toString(), ConflictType.SCHEDULE_OVERDUE,
                targetGone.getUuid().toString(), ConflictType.SCHEDULE_TARGET_MISSING,
                deletion.getUuid().toString(), ConflictType.SCHEDULE_INVALID));
        assertThat(details(result.scheduleWarnings(), ConflictType.SCHEDULE_INVALID)).singleElement()
                .asString().startsWith("Not imported: SF-DOM-0151");
        assertThat(imported(dst, clash).getParams().path("targetId").asLong()).isEqualTo(dst.target().getId());
        assertThat(imported(dst, fine).getStatus()).isEqualTo(ActionStatus.PENDING);
        assertThat(actionRepository.findByProjectIdAndUuid(dst.id(), deletion.getUuid())).isEmpty();
        assertThat(assetRepository.findByProjectIdAndUuid(dst.id(), kept)).as("the rest of the import committed").isPresent();
    }

    @Test
    @DisplayName("a release in a locale the target doesn't have is invalid, in the analysis and at commit")
    void localeTheTargetLacksIsInvalid() throws Exception {
        Fixture src = fixture("sxh", null, true);
        UUID page = localizedPage(src, "home");
        ObjectNode params = mapper.createObjectNode();
        params.putArray("items").addObject().put("assetUuid", page.toString()).put("locale", "en");
        ScheduledAction english = scheduleService.create(src.id(), new ScheduleService.Command(
                "RELEASE", inTwoDays(), null, null, PinPolicy.PINNED, null, null, null, params), src.owner().getId());
        byte[] archive = exportImportService.exportProject(src.id());

        Fixture dst = fixture("sxi", null, false);
        projectService.updateLocales(dst.project().getKey(),
                LocaleConfig.of(List.of(new ProjectLocale("fr", "Français")), "fr", Map.of(), true), true, dst.importCtx());
        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), archive, ImportOptions.DEFAULT);
        assertThat(analysis.conflicts()).filteredOn(c -> c.type() == ConflictType.SCHEDULE_INVALID).singleElement()
                .satisfies(c -> assertThat(c.detail()).contains("has no locale 'en'"));

        ImportResult result = exportImportService.importProject(dst.id(), archive, dst.importCtx(), ImportOptions.DEFAULT);
        assertThat(typesByUuid(result.scheduleWarnings()))
                .containsEntry(english.getUuid().toString(), ConflictType.SCHEDULE_INVALID);
        assertThat(actionRepository.findByProjectIdAndUuid(dst.id(), english.getUuid())).isEmpty();
        assertThat(assetRepository.findByProjectIdAndUuid(dst.id(), page)).isPresent();
    }

    // ------------------------------------------------------------------
    // Export selection, options, older archives
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a selection carries a release only when all its assets are selected, generations always, open schedules only")
    void selectionCarriesCoveredOpenSchedules() throws Exception {
        Fixture fx = fixture("sxj", "Production", false);
        UUID one = page(fx, "one", "One v1");
        UUID two = page(fx, "two", "Two v1");
        Instant runAt = inTwoDays();
        ScheduledAction covered = scheduleService.create(fx.id(), new ScheduleService.Command(
                "RELEASE", runAt, null, null, PinPolicy.LATEST, null, null, null, items(List.of(one), null)), fx.owner().getId());
        ScheduledAction uncovered = scheduleService.create(fx.id(), new ScheduleService.Command(
                "RELEASE", runAt, null, null, PinPolicy.LATEST, null, null, null, items(List.of(one, two), null)),
                fx.owner().getId());
        ScheduledAction build = scheduleService.create(fx.id(), new ScheduleService.Command(
                "GENERATION", runAt, null, null, null, null, null, null, generation("FULL", null)), fx.owner().getId());
        ScheduledAction cancelled = scheduleService.create(fx.id(), new ScheduleService.Command(
                "GENERATION", runAt, null, null, null, null, null, null, generation("FULL", null)), fx.owner().getId());
        scheduleService.cancel(fx.id(), cancelled.getId(), fx.owner().getId());
        schedulerFixtures.crash(covered.getId(), "node-x", Instant.now().plus(Duration.ofMinutes(5)));

        byte[] selected = exportImportService.exportSelection(fx.id(), new ExportSelection(Set.of(one), false, false, Set.of(), true));
        assertThat(entries(selected).keySet()).filteredOn(name -> name.startsWith("schedules/")).containsExactlyInAnyOrder(
                "schedules/" + covered.getUuid() + ".json", "schedules/" + build.getUuid() + ".json");
        assertThat(mapper.readTree(entry(selected, "schedules/" + covered.getUuid() + ".json")).path("status").asText())
                .as("an executing schedule is exported as pending").isEqualTo("PENDING");
        assertThat(entries(exportImportService.exportProject(fx.id())).keySet())
                .contains("schedules/" + uncovered.getUuid() + ".json")
                .doesNotContain("schedules/" + cancelled.getUuid() + ".json");

        byte[] without = exportImportService.exportSelection(fx.id(), new ExportSelection(Set.of(one), false, false, Set.of()));
        assertThat(entries(without).keySet()).noneMatch(name -> name.startsWith("schedules/"));
        byte[] schedulesOnly = exportImportService.exportSelection(fx.id(), new ExportSelection(Set.of(), false, false, Set.of(), true));
        assertThat(entries(schedulesOnly).keySet()).filteredOn(name -> name.startsWith("schedules/"))
                .containsExactly("schedules/" + build.getUuid() + ".json");
    }

    @Test
    @DisplayName("'don't import schedules' imports none but still counts them; a protocol 8 archive imports without any")
    void optionAndOlderArchives() throws Exception {
        Fixture src = fixture("sxk", "Production", false);
        page(src, "one", "One v1");
        ScheduledAction build = scheduleService.create(src.id(), new ScheduleService.Command(
                "GENERATION", inTwoDays(), null, null, null, null, null, null, generation("FULL", src.target().getId())),
                src.owner().getId());
        byte[] archive = exportImportService.exportProject(src.id());

        Fixture dst = fixture("sxl", null, false);
        ImportOptions skipSchedules = new ImportOptions(false, ReleaseMode.KEEP, false);
        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), archive, skipSchedules);
        assertThat(analysis.scheduleCount()).isEqualTo(1);
        assertThat(analysis.conflicts()).noneMatch(c -> c.type().name().contains("SCHEDULE"));
        ImportResult result = exportImportService.importProject(dst.id(), archive, dst.importCtx(), skipSchedules);
        assertThat(result.importedScheduleCount()).isZero();
        assertThat(actionRepository.findByProjectIdAndUuid(dst.id(), build.getUuid())).isEmpty();
        assertThat(targetRepository.findByProjectId(dst.id())).singleElement()
                .satisfies(t -> assertThat(t.getUuid()).as("keeps the archive's uuid").isEqualTo(src.target().getUuid()));

        // An archive as protocol 8 wrote it: no schedules, targets without uuid.
        byte[] protocol8 = rewrite(archive, (name, text) -> {
            if (name.startsWith("schedules/")) {
                return null;
            }
            if (name.equals("manifest.json")) {
                return text.replace("\"protocolVersion\":9", "\"protocolVersion\":8");
            }
            return name.equals("settings.json") ? text.replaceAll("\"uuid\":\"[0-9a-f-]+\",", "") : text;
        });
        assertThat(entry(protocol8, "settings.json")).doesNotContain("uuid");
        Fixture older = fixture("sxm", null, false);
        ConflictReport olderAnalysis = exportImportService.analyzeImport(older.id(), protocol8, ImportOptions.DEFAULT);
        assertThat(olderAnalysis.scheduleCount()).isZero();
        assertThat(olderAnalysis.blocksImport()).isFalse();
        ImportResult olderResult = exportImportService.importProject(older.id(), protocol8, older.importCtx(), ImportOptions.DEFAULT);
        assertThat(olderResult.importedAssetCount()).isPositive();
        assertThat(olderResult.importedScheduleCount()).isZero();
        assertThat(targetRepository.findByProjectId(older.id())).singleElement()
                .satisfies(t -> assertThat(t.getUuid()).isNotNull().isNotEqualTo(src.target().getUuid()));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private Fixture fixture(String prefix, String targetName, boolean localized) throws IOException {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(prefix + n + "-admin", prefix + n + "-admin@example.com", "Admin", "secret-password");
        AppUser owner = userService.create(prefix + n + "-owner", prefix + n + "-owner@example.com", "Owner", "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "schedule export/import"), admin.getId());
        projectService.setMemberRole(project.getKey(), owner.getId(), ProjectRole.DEVELOPER,
                RevisionContext.of(project.getId(), admin.getId(), "member"));
        RevisionContext ctx = RevisionContext.of(project.getId(), owner.getId(), "fixture");
        if (localized) {
            projectService.updateLocales(project.getKey(),
                    LocaleConfig.of(List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English")), "de",
                            Map.of(), true),
                    true, ctx);
        }
        GenerationTarget target = targetName == null
                ? null
                : targetRepository.save(new GenerationTarget(project.getId(), targetName, TargetType.FILESYSTEM, config(), true));
        TemplateView template = templateService.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE,
                "Page", localized ? LOCALIZED_CDL : CDL, Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false,
                Map.of("html", localized ? "{locale}/{folder}{uid}.{ext}" : "{folder}{uid}.{ext}")), ctx);
        projects.add(project.getId());
        return new Fixture(project, admin, owner, template, target);
    }

    private JsonNode config() throws IOException {
        return mapper.readTree("{\"baseUrl\":\"https://example.com\"}");
    }

    private UUID page(Fixture fx, String name, String title) {
        AssetVersionView page = pageService.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx());
        setTitle(fx, page.uuid(), title);
        return page.uuid();
    }

    private void setTitle(Fixture fx, UUID page, String title) {
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        payload.withObject("content").put("title", title);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
    }

    private UUID localizedPage(Fixture fx, String name) {
        UUID page = pageService.create(new CreatePageCommand(name, null, fx.template().uuid()), fx.ctx()).uuid();
        AssetVersionView current = assetService.requireCurrent(fx.id(), page);
        ObjectNode payload = current.payload().deepCopy();
        ObjectNode title = L10nValues.empty();
        title.withObject("/values").set("de", JsonNodeFactory.instance.textNode(name + " DE"));
        title.withObject("/values").set("en", JsonNodeFactory.instance.textNode(name + " EN"));
        payload.withObject("content").set("title", title);
        pageService.update(page, payload, current.validFromRevision(), fx.ctx());
        return page;
    }

    private long openVersion(Fixture fx, UUID page) {
        long assetId = assetRepository.findByProjectIdAndUuid(fx.id(), page).orElseThrow().getId();
        return versionRepository.findByAssetIdAndValidToRevisionIsNull(assetId).orElseThrow().getId();
    }

    private static Instant inTwoDays() {
        return Instant.now().plus(Duration.ofDays(2)).truncatedTo(ChronoUnit.SECONDS);
    }

    private ObjectNode items(List<UUID> uuids, String comment) {
        ObjectNode params = mapper.createObjectNode();
        ArrayNode items = params.putArray("items");
        uuids.forEach(u -> items.addObject().put("assetUuid", u.toString()));
        if (comment != null) {
            params.put("comment", comment);
        }
        return params;
    }

    private ObjectNode thenGenerate(Long targetId) {
        ObjectNode then = mapper.createObjectNode();
        if (targetId == null) {
            then.putNull("targetId");
        } else {
            then.put("targetId", targetId);
        }
        then.putArray("channels").add("html");
        return then;
    }

    private ObjectNode generation(String mode, Long targetId) {
        ObjectNode params = mapper.createObjectNode();
        params.put("mode", mode);
        params.putArray("channels").add("html");
        if (targetId == null) {
            params.putNull("targetId");
        } else {
            params.put("targetId", targetId);
        }
        return params;
    }

    private ScheduledAction imported(Fixture dst, ScheduledAction source) {
        return actionRepository.findByProjectIdAndUuid(dst.id(), source.getUuid()).orElseThrow();
    }

    private static JsonNode item(JsonNode schedule, UUID asset) {
        for (JsonNode item : schedule.path("items")) {
            if (item.path("assetUuid").asText().equals(asset.toString())) {
                return item;
            }
        }
        throw new AssertionError("No item for " + asset);
    }

    private static long pinOf(ScheduledAction action, UUID asset) {
        for (JsonNode item : action.getParams().path("items")) {
            if (item.path("assetUuid").asText().equals(asset.toString())) {
                return item.path("pinnedVersionId").asLong();
            }
        }
        throw new AssertionError("No item for " + asset);
    }

    private static Map<String, ConflictType> typesByUuid(List<ImportConflict> conflicts) {
        Map<String, ConflictType> out = new TreeMap<>();
        conflicts.stream()
                .filter(c -> c.type().name().contains("SCHEDULE"))
                .forEach(c -> out.put(c.elementUuid(), c.type()));
        return out;
    }

    private static List<String> details(List<ImportConflict> conflicts, ConflictType type) {
        return conflicts.stream().filter(c -> c.type() == type).map(ImportConflict::detail).toList();
    }

    private static Map<String, byte[]> entries(byte[] archive) throws IOException {
        Map<String, byte[]> out = new TreeMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                out.put(entry.getName(), zip.readAllBytes());
            }
        }
        return out;
    }

    private static String entry(byte[] archive, String name) throws IOException {
        byte[] bytes = entries(archive).get(name);
        if (bytes == null) {
            throw new AssertionError("No archive entry " + name);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** {@code archive} with each JSON entry passed through {@code edit} (a {@code null} result drops it). */
    private static byte[] rewrite(byte[] archive, BiFunction<String, String, String> edit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            for (Map.Entry<String, byte[]> e : entries(archive).entrySet()) {
                byte[] bytes = e.getValue();
                if (e.getKey().endsWith(".json")) {
                    String text = edit.apply(e.getKey(), new String(bytes, StandardCharsets.UTF_8));
                    if (text == null) {
                        continue;
                    }
                    bytes = text.getBytes(StandardCharsets.UTF_8);
                }
                zip.putNextEntry(new ZipEntry(e.getKey()));
                zip.write(bytes);
                zip.closeEntry();
            }
        }
        return out.toByteArray();
    }
}
