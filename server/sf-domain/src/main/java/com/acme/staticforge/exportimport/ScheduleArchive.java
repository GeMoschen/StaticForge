package com.acme.staticforge.exportimport;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.exportimport.ExportedSchedule.ExportedGeneration;
import com.acme.staticforge.exportimport.ExportedSchedule.ExportedScheduleItem;
import com.acme.staticforge.exportimport.ExportedSchedule.ExportedTargetRef;
import com.acme.staticforge.exportimport.ExportedSchedule.ExportedThenGenerate;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.release.Chunks;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.scheduler.ActionSpec;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.ActionAuthority;
import com.acme.staticforge.scheduler.MissedPolicy;
import com.acme.staticforge.scheduler.PinPolicy;
import com.acme.staticforge.scheduler.ScheduleService;
import com.acme.staticforge.scheduler.ScheduleService.ImportOutcome;
import com.acme.staticforge.scheduler.ScheduleTiming;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionHandler;
import com.acme.staticforge.scheduler.ScheduledActionHandlers;
import com.acme.staticforge.scheduler.ScheduledActionRepository;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * The schedules of an export archive (M27.8.1, protocol {@code 9}): which open schedules an export carries and how
 * they are written ({@link ExportedSchedule}), what an import analysis says about them, and how an import brings them
 * in through {@link ScheduleService#importAction}. The archive holds no database id, so the import resolves every
 * reference against the target: assets by uuid, pinned versions by content (the imported draft, a version written
 * like a released payload, or — for an asset the import reused — the target's draft), generation targets by uuid (a
 * target skipped for a name clash by that name), users by username.
 *
 * <p>A schedule that can't be imported as it is — overdue, its target missing, failing a create's checks, or shadowed
 * by a schedule that executes or has finished — is left out with a warning; nothing about it blocks the import.
 */
@Component
class ScheduleArchive {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final String RELEASE = "RELEASE";
    private static final String UNPUBLISH = "UNPUBLISH";
    /** The types an archive describes; another handler's actions (a later milestone's) stay out of it. */
    private static final Set<String> GENERATIONS = Set.of("GENERATION", "RECURRING_GENERATION");

    private final ScheduledActionRepository actions;
    private final ScheduleService schedules;
    private final ScheduledActionHandlers handlers;
    private final ActionAuthority authority;
    private final UserService users;
    private final AssetRepository assetRepository;
    private final AssetVersionRepository versionRepository;
    private final Clock clock;

    ScheduleArchive(
            ScheduledActionRepository actions,
            ScheduleService schedules,
            ScheduledActionHandlers handlers,
            ActionAuthority authority,
            UserService users,
            AssetRepository assetRepository,
            AssetVersionRepository versionRepository,
            Clock clock) {
        this.actions = actions;
        this.schedules = schedules;
        this.handlers = handlers;
        this.authority = authority;
        this.users = users;
        this.assetRepository = assetRepository;
        this.versionRepository = versionRepository;
        this.clock = clock;
    }

    // ------------------------------------------------------------------
    // Export
    // ------------------------------------------------------------------

    /**
     * The open schedules of a project as an archive carries them, sorted by uuid. A release or unpublish is carried
     * only when every asset it works on is in the archive ({@code archived}, by uuid) — unless {@code full}: a full
     * export carries every open schedule. A pinned version that is the exported draft becomes {@code DRAFT_EQUALS};
     * any other is carried with its content, and {@code mediaPayloads} receives the payload of each pinned media
     * version, so its files travel as blobs. A schedule whose pinned version is gone (only reachable through manual
     * SQL), and one of a type this format doesn't describe, is left out.
     */
    List<ExportedSchedule> export(
            long projectId, Map<UUID, AssetVersion> archived, List<GenerationTarget> targets, boolean full,
            Consumer<JsonNode> mediaPayloads) {
        List<ScheduledAction> open = actions.findByProjectIdAndStatusInOrderById(
                projectId, List.of(ActionStatus.PENDING, ActionStatus.RUNNING, ActionStatus.FAILED)).stream()
                .filter(ScheduleService::isOpen)
                .toList();
        if (open.isEmpty()) {
            return List.of();
        }
        Map<Long, GenerationTarget> targetById = new HashMap<>();
        targets.forEach(t -> targetById.put(t.getId(), t));
        Map<Long, AssetVersion> pinned = pinnedVersions(open, archived);
        Set<Long> pinnedMedia = new HashSet<>();
        Set<Long> pinnedAssetIds = pinned.values().stream().map(AssetVersion::getAssetId).collect(Collectors.toSet());
        if (!pinnedAssetIds.isEmpty()) {
            Chunks.flatMap(pinnedAssetIds, assetRepository::findAllById).stream()
                    .filter(asset -> asset.getAssetType() == AssetType.MEDIA)
                    .forEach(asset -> pinnedMedia.add(asset.getId()));
        }
        Map<Long, String> uuidByAssetId = uuidsOfPlacement(pinned.values(), archived);
        Map<Long, String> usernames = usernames(open);

        List<ExportedSchedule> out = new ArrayList<>();
        for (ScheduledAction action : open) {
            boolean stateChange = RELEASE.equals(action.getType()) || UNPUBLISH.equals(action.getType());
            if (!stateChange && !GENERATIONS.contains(action.getType())) {
                continue;
            }
            List<ExportedScheduleItem> items = null;
            ExportedThenGenerate thenGenerate = null;
            ExportedGeneration generation = null;
            if (stateChange) {
                items = items(action, archived, pinned, pinnedMedia, uuidByAssetId, full, mediaPayloads);
                if (items == null) {
                    continue;
                }
                JsonNode then = action.getThenGenerate();
                if (then != null && then.isObject()) {
                    thenGenerate = new ExportedThenGenerate(targetRef(then.path("targetId"), targetById), strings(then.path("channels")));
                }
            } else {
                JsonNode params = action.getParams();
                JsonNode scope = params.path("scope");
                generation = new ExportedGeneration(
                        params.path("mode").asText(null),
                        strings(params.path("channels")),
                        targetRef(params.path("targetId"), targetById),
                        scope.path("folderPath").isTextual() ? scope.path("folderPath").asText() : null,
                        strings(scope.path("assetUuids")));
            }
            JsonNode comment = action.getParams().path("comment");
            out.add(new ExportedSchedule(
                    action.getUuid().toString(),
                    action.getType(),
                    action.getStatus() == ActionStatus.FAILED ? ActionStatus.FAILED.name() : ActionStatus.PENDING.name(),
                    action.getRunAt(),
                    action.getCron(),
                    action.getZoneId(),
                    action.getPinPolicy() == null ? null : action.getPinPolicy().name(),
                    action.getMissedPolicy().name(),
                    action.getMaxLateness() == null ? null : action.getMaxLateness().toSeconds(),
                    usernames.get(action.getOwnerUserId()),
                    usernames.get(action.getCreatedBy()),
                    action.getCreatedAt(),
                    comment.isTextual() ? comment.asText() : null,
                    items,
                    thenGenerate,
                    generation));
        }
        out.sort(Comparator.comparing(ExportedSchedule::uuid));
        return out;
    }

    /** The items of a release or unpublish, or {@code null} when the schedule stays out of the archive. */
    private static List<ExportedScheduleItem> items(
            ScheduledAction action, Map<UUID, AssetVersion> archived, Map<Long, AssetVersion> pinned, Set<Long> pinnedMedia,
            Map<Long, String> uuidByAssetId, boolean full, Consumer<JsonNode> mediaPayloads) {
        List<ExportedScheduleItem> items = new ArrayList<>();
        for (JsonNode entry : action.getParams().path("items")) {
            UUID assetUuid = UUID.fromString(entry.path("assetUuid").asText());
            AssetVersion draft = archived.get(assetUuid);
            if (draft == null && !full) {
                return null;
            }
            String locale = entry.path("locale").asText(ReleaseLocales.ALL);
            boolean deletion = entry.path("deletion").asBoolean(false);
            ExportedRelease pin = null;
            if (entry.path("pinnedVersionId").isIntegralNumber()) {
                long versionId = entry.path("pinnedVersionId").asLong();
                if (draft != null && draft.getId() == versionId) {
                    pin = ExportedRelease.draftEquals(locale, null);
                } else {
                    AssetVersion version = pinned.get(versionId);
                    if (version == null) {
                        return null;
                    }
                    boolean media = pinnedMedia.contains(version.getAssetId());
                    if (media) {
                        mediaPayloads.accept(version.getPayload());
                    }
                    pin = new ExportedRelease(
                            locale,
                            ExportedRelease.State.PAYLOAD,
                            null,
                            version.getPayload(),
                            version.getDisplayName(),
                            version.getFolderId() == null ? null : uuidByAssetId.get(version.getFolderId()),
                            version.getFolderPath(),
                            version.getTemplateAssetId() == null ? null : uuidByAssetId.get(version.getTemplateAssetId()),
                            media ? version.getMimeType() : null,
                            media ? version.getSizeBytes() : null);
                }
            }
            items.add(new ExportedScheduleItem(assetUuid.toString(), locale, deletion ? Boolean.TRUE : null, pin));
        }
        return items;
    }

    /** The pinned versions the schedules name that aren't exported drafts, by id. */
    private Map<Long, AssetVersion> pinnedVersions(List<ScheduledAction> open, Map<UUID, AssetVersion> archived) {
        Set<Long> draftIds = archived.values().stream().map(AssetVersion::getId).collect(Collectors.toSet());
        Set<Long> ids = new HashSet<>();
        for (ScheduledAction action : open) {
            for (JsonNode entry : action.getParams().path("items")) {
                if (entry.path("pinnedVersionId").isIntegralNumber() && !draftIds.contains(entry.path("pinnedVersionId").asLong())) {
                    ids.add(entry.path("pinnedVersionId").asLong());
                }
            }
        }
        Map<Long, AssetVersion> byId = new HashMap<>();
        if (!ids.isEmpty()) {
            Chunks.flatMap(ids, versionRepository::findAllById).forEach(v -> byId.put(v.getId(), v));
        }
        return byId;
    }

    /** The uuids of the parent folders and templates of {@code versions}. */
    private Map<Long, String> uuidsOfPlacement(Collection<AssetVersion> versions, Map<UUID, AssetVersion> archived) {
        Map<Long, String> uuids = new HashMap<>();
        archived.forEach((uuid, version) -> uuids.put(version.getAssetId(), uuid.toString()));
        Set<Long> missing = new HashSet<>();
        for (AssetVersion version : versions) {
            for (Long id : new Long[] {version.getFolderId(), version.getTemplateAssetId()}) {
                if (id != null && !uuids.containsKey(id)) {
                    missing.add(id);
                }
            }
        }
        if (!missing.isEmpty()) {
            Chunks.flatMap(missing, assetRepository::findAllById).forEach(a -> uuids.put(a.getId(), a.getUuid().toString()));
        }
        return uuids;
    }

    /** The usernames of the owners and creators; a deleted account has none. */
    private Map<Long, String> usernames(List<ScheduledAction> open) {
        Map<Long, String> names = new HashMap<>();
        Set<Long> ids = new HashSet<>();
        open.forEach(a -> {
            ids.add(a.getOwnerUserId());
            ids.add(a.getCreatedBy());
        });
        ids.remove(null);
        for (Long id : ids) {
            users.findById(id)
                    .filter(user -> user.getStatus() != UserStatus.DELETED)
                    .ifPresent(user -> names.put(id, user.getUsername()));
        }
        return names;
    }

    private static ExportedTargetRef targetRef(JsonNode targetId, Map<Long, GenerationTarget> targets) {
        if (!targetId.isIntegralNumber()) {
            return null;
        }
        GenerationTarget target = targets.get(targetId.asLong());
        return target == null
                ? new ExportedTargetRef(null, null, true)
                : new ExportedTargetRef(target.getUuid().toString(), target.getName(), null);
    }

    // ------------------------------------------------------------------
    // Import
    // ------------------------------------------------------------------

    /**
     * What an import knows about the target when it looks at the archive's schedules.
     *
     * @param assets what each asset uuid (lower case) will be in the target once the import has run — the archive's
     *     copy, or the target's current version; absent when it is in neither
     * @param locales the languages the target will have
     * @param targets the generation targets as a schedule can name them (see {@link Targets})
     * @param channels whether each output channel key will be enabled in the target
     */
    record TargetView(Map<String, AssetState> assets, LocaleConfig locales, Targets targets, Map<String, Boolean> channels) {}

    /** An asset as the import will find it. */
    record AssetState(AssetType type, JsonNode payload) {}

    /**
     * The generation targets a schedule can name: by uuid ({@code idByUuid}; {@code null} for a target the import
     * creates, which has no id yet during analysis), and — for an archived target the import skips for a name clash —
     * the same-named target of the project ({@code idByClashingUuid}).
     */
    record Targets(Map<String, Long> idByUuid, Map<String, Long> idByClashingUuid) {

        /** Built from the targets the project has (after or before the settings import) and the settings plan. */
        static Targets of(List<GenerationTarget> project, List<TargetImportPlan.Decision> plan) {
            Map<String, Long> byUuid = new HashMap<>();
            project.forEach(t -> byUuid.put(t.getUuid().toString(), t.getId()));
            Map<String, List<Long>> byName = new HashMap<>();
            project.forEach(t -> byName.computeIfAbsent(t.getName(), n -> new ArrayList<>()).add(t.getId()));
            Map<String, Long> clashing = new HashMap<>();
            for (TargetImportPlan.Decision decision : plan) {
                String uuid = decision.source().uuid() == null ? null : decision.source().uuid().toLowerCase(Locale.ROOT);
                if (uuid == null) {
                    continue;
                }
                if (decision.action() == TargetImportPlan.Action.SKIP_NAME_COLLISION) {
                    List<Long> named = byName.getOrDefault(decision.source().name(), List.of());
                    if (named.size() == 1) {
                        clashing.put(uuid, named.get(0));
                    }
                } else if (decision.action() != TargetImportPlan.Action.SKIP_SAME_TARGET) {
                    byUuid.putIfAbsent(uuid, null);
                }
            }
            return new Targets(byUuid, clashing);
        }

        /** Whether {@code ref} resolves; {@code null} (the default target) always does. */
        boolean resolves(ExportedTargetRef ref) {
            return ref == null || (!Boolean.TRUE.equals(ref.missing()) && ref.uuid() != null
                    && (idByUuid.containsKey(key(ref)) || idByClashingUuid.containsKey(key(ref))));
        }

        /** The id {@code ref} resolves to ({@code null} for the default target); only after the settings import. */
        Long idOf(ExportedTargetRef ref) {
            if (ref == null) {
                return null;
            }
            Long id = idByUuid.get(key(ref));
            return id != null ? id : idByClashingUuid.get(key(ref));
        }

        private static String key(ExportedTargetRef ref) {
            return ref.uuid().toLowerCase(Locale.ROOT);
        }
    }

    /**
     * How the import writes what a schedule refers to.
     */
    interface Writes {

        /** The uuid an archive asset has in the target (the fixed root folders are remapped, see the import). */
        UUID assetUuid(String archiveUuid);

        /**
         * The version a pinned item pins in the target: the imported draft, a version written for a {@code PAYLOAD}
         * pin, or the target's draft of an asset the import reused; {@code null} when the asset isn't there.
         */
        Long pinnedVersion(String archiveUuid, ExportedRelease pin);

        /** An archive folder path moved onto the target's folders. */
        String folderPath(String archivePath);
    }

    /** The analysis warnings of the archive's schedules; none blocks the import. */
    List<ImportConflict> analyze(long projectId, List<ExportedSchedule> archived, TargetView view) {
        List<ImportConflict> conflicts = new ArrayList<>();
        Instant now = clock.instant();
        for (ExportedSchedule schedule : archived) {
            String label = label(schedule);
            Optional<Skip> skip = precheck(projectId, schedule, view.targets(), now)
                    .or(() -> invalidReferences(schedule, view));
            if (skip.isPresent()) {
                conflicts.add(skip.get().conflict(schedule, label));
                continue;
            }
            actions.findByProjectIdAndUuid(projectId, UUID.fromString(schedule.uuid())).ifPresent(existing ->
                    conflicts.add(ImportConflict.of(ConflictType.DUPLICATE_SCHEDULE, schedule.uuid(), label,
                            "Replaces schedule #" + existing.getId() + ", which has the same identity.")));
            Owner owner = owner(projectId, schedule);
            if (owner.userId() == null) {
                conflicts.add(ownerReplaced(schedule, label, owner.replacedBecause()));
            }
        }
        return conflicts;
    }

    /** What an import did with the archive's schedules. */
    record Result(int created, int replaced, List<ImportConflict> warnings) {}

    /**
     * Imports the archive's schedules into the target, after its assets, release state and settings, in the import's
     * transaction. The cheap checks come first, so a skipped schedule writes no pinned version.
     */
    Result importAll(
            long projectId, List<ExportedSchedule> archived, Targets targets, Writes writes, long importerUserId,
            String sourceProjectKey) {
        int created = 0;
        int replaced = 0;
        List<ImportConflict> warnings = new ArrayList<>();
        Instant now = clock.instant();
        for (ExportedSchedule schedule : archived) {
            String label = label(schedule);
            Optional<Skip> skip = precheck(projectId, schedule, targets, now);
            if (skip.isPresent()) {
                warnings.add(skip.get().conflict(schedule, label));
                continue;
            }
            Owner owner = owner(projectId, schedule);
            ScheduleService.ImportCommand command = new ScheduleService.ImportCommand(
                    UUID.fromString(schedule.uuid()),
                    command(schedule, targets, writes),
                    ActionStatus.FAILED.name().equals(schedule.status()) ? ActionStatus.FAILED : ActionStatus.PENDING,
                    owner.userId() == null ? importerUserId : owner.userId(),
                    createdBy(schedule),
                    schedule.createdAt() == null ? now : schedule.createdAt());
            ImportOutcome outcome = schedules.importAction(projectId, command, importerUserId, sourceProjectKey);
            switch (outcome) {
                case ImportOutcome.Created c -> created++;
                case ImportOutcome.Replaced r -> {
                    replaced++;
                    warnings.add(ImportConflict.of(ConflictType.DUPLICATE_SCHEDULE, schedule.uuid(), label,
                            "Replaced schedule #" + r.action().getId() + ", which had the same identity."));
                }
                case ImportOutcome.Kept k -> warnings.add(ImportConflict.of(ConflictType.DUPLICATE_SCHEDULE,
                        schedule.uuid(), label, "Not imported: schedule #" + k.action().getId()
                                + " has the same identity and " + k.reason() + "."));
                case ImportOutcome.Refused f -> warnings.add(ImportConflict.of(ConflictType.SCHEDULE_INVALID,
                        schedule.uuid(), label, "Not imported: " + (f.code() == null ? "" : f.code() + " ") + f.message()));
            }
            boolean imported = outcome instanceof ImportOutcome.Created || outcome instanceof ImportOutcome.Replaced;
            if (imported && owner.userId() == null) {
                warnings.add(ownerReplaced(schedule, label, owner.replacedBecause()));
            }
        }
        return new Result(created, replaced, warnings);
    }

    /**
     * Why a schedule is left out before anything is written — an unknown type, a one-off whose time has passed, a
     * target that doesn't resolve, a schedule with the same identity that executes or has finished; empty when it goes
     * on to the create checks.
     */
    private Optional<Skip> precheck(long projectId, ExportedSchedule schedule, Targets targets, Instant now) {
        if (handlers.find(schedule.type()).isEmpty()) {
            return Optional.of(new Skip(ConflictType.SCHEDULE_INVALID, "unknown schedule type '" + schedule.type() + "'."));
        }
        if (schedule.cron() == null && schedule.runAt() != null && schedule.runAt().isBefore(now)) {
            return Optional.of(new Skip(ConflictType.SCHEDULE_OVERDUE, "its time (" + schedule.runAt() + ") has passed."));
        }
        ExportedTargetRef target = schedule.generation() != null
                ? schedule.generation().target()
                : schedule.thenGenerate() == null ? null : schedule.thenGenerate().target();
        if (!targets.resolves(target)) {
            return Optional.of(new Skip(ConflictType.SCHEDULE_TARGET_MISSING, (Boolean.TRUE.equals(target.missing())
                    ? "its generation target was deleted before the export."
                    : "its generation target '" + target.name() + "' is neither in the archive nor in this project.")));
        }
        Optional<ScheduledAction> existing = actions.findByProjectIdAndUuid(projectId, UUID.fromString(schedule.uuid()));
        if (existing.isPresent()) {
            ScheduledAction action = existing.get();
            if (!action.getType().equals(schedule.type())) {
                return Optional.of(new Skip(ConflictType.SCHEDULE_INVALID, "schedule #" + action.getId()
                        + " has this identity with another type (" + action.getType() + ")."));
            }
            if (!ScheduleService.isOpen(action) || action.getStatus() == ActionStatus.RUNNING) {
                return Optional.of(new Skip(ConflictType.DUPLICATE_SCHEDULE, "schedule #" + action.getId() + " has the same identity and "
                        + (action.getStatus() == ActionStatus.RUNNING
                                ? "is executing."
                                : "has finished (" + action.getStatus() + ").")));
            }
        }
        return Optional.empty();
    }

    /**
     * The analysis-only checks of what a schedule refers to: its assets exist in the archive or the target with the
     * locale keys it names, its channels are enabled, its timing parses. The commit applies a create's checks, which
     * also cover a pinned version's completeness and a folder scope.
     */
    private Optional<Skip> invalidReferences(ExportedSchedule schedule, TargetView view) {
        try {
            if (schedule.cron() != null) {
                ScheduleTiming.nextAfter(ScheduleTiming.normalizeCron(schedule.cron()), ScheduleTiming.zone(schedule.zoneId()),
                        clock.instant());
            }
        } catch (SfException invalid) {
            return Optional.of(new Skip(ConflictType.SCHEDULE_INVALID, invalid.getProblem().getDetail()));
        }
        for (ExportedScheduleItem item : schedule.items() == null ? List.<ExportedScheduleItem>of() : schedule.items()) {
            AssetState asset = view.assets().get(item.assetUuid().toLowerCase(Locale.ROOT));
            if (asset == null) {
                return Optional.of(new Skip(ConflictType.SCHEDULE_INVALID, "asset " + item.assetUuid()
                        + " is neither in the archive nor in this project."));
            }
            String locale = item.locale() == null ? ReleaseLocales.ALL : item.locale();
            if (!ReleaseLocales.keysFor(view.locales(), asset.type(), asset.payload()).contains(locale)) {
                return Optional.of(new Skip(ConflictType.SCHEDULE_INVALID, "asset " + item.assetUuid() + " has no locale "
                        + (locale.isEmpty() ? "'' (all languages)" : "'" + locale + "'") + " in this project."));
            }
        }
        List<String> channels = schedule.generation() != null
                ? schedule.generation().channels()
                : schedule.thenGenerate() == null ? null : schedule.thenGenerate().channels();
        for (String channel : channels == null ? List.<String>of() : channels) {
            if (!Boolean.TRUE.equals(view.channels().get(channel))) {
                return Optional.of(new Skip(ConflictType.SCHEDULE_INVALID, "channel '" + channel + "' is unknown or disabled in this project."));
            }
        }
        return Optional.empty();
    }

    /**
     * The archive's owner of a schedule in the target: {@code userId} when that user may own it here, else {@code
     * null} and why — the importing user owns it then.
     */
    private record Owner(Long userId, String replacedBecause) {}

    private Owner owner(long projectId, ExportedSchedule schedule) {
        ScheduledActionHandler handler = handlers.find(schedule.type()).orElseThrow();
        ActionSpec spec = new ActionSpec(projectId, null, handler.type(), null, null, null, schedule.cron() != null);
        String name = schedule.ownerUsername();
        Optional<AppUser> user = name == null || name.toLowerCase(Locale.ROOT).startsWith(UserService.DELETED_USERNAME_PREFIX)
                ? Optional.empty()
                : users.findByUsername(name);
        if (user.isEmpty()) {
            return new Owner(null, name == null ? "the owner's account was deleted" : "there is no user '" + name + "' here");
        }
        return authority.denial(projectId, user.get().getId(), handler.requirements(spec))
                .map(reason -> new Owner(null, reason))
                .orElseGet(() -> new Owner(user.get().getId(), null));
    }

    /** The creator: the matching user whatever their status (it is history), else none. */
    private Long createdBy(ExportedSchedule schedule) {
        String name = schedule.createdByUsername();
        if (name == null || name.toLowerCase(Locale.ROOT).startsWith(UserService.DELETED_USERNAME_PREFIX)) {
            return null;
        }
        return users.findByUsername(name).map(AppUser::getId).orElse(null);
    }

    /** The create command of an archived schedule, its references resolved in the target. */
    private static ScheduleService.Command command(ExportedSchedule schedule, Targets targets, Writes writes) {
        ObjectNode params = JSON.objectNode();
        JsonNode thenGenerate = null;
        if (schedule.generation() != null) {
            ExportedGeneration generation = schedule.generation();
            params.put("mode", generation.mode());
            ArrayNode channels = params.putArray("channels");
            (generation.channels() == null ? List.<String>of() : generation.channels()).forEach(channels::add);
            putTarget(params, targets.idOf(generation.target()));
            ObjectNode scope = params.putObject("scope");
            if (generation.folderPath() == null) {
                scope.putNull("folderPath");
            } else {
                scope.put("folderPath", writes.folderPath(generation.folderPath()));
            }
            ArrayNode uuids = scope.putArray("assetUuids");
            (generation.assetUuids() == null ? List.<String>of() : generation.assetUuids())
                    .forEach(uuid -> uuids.add(writes.assetUuid(uuid).toString()));
        } else {
            params.put("resolved", true);
            ArrayNode items = params.putArray("items");
            for (ExportedScheduleItem item : schedule.items() == null ? List.<ExportedScheduleItem>of() : schedule.items()) {
                ObjectNode stored = items.addObject();
                stored.put("assetUuid", writes.assetUuid(item.assetUuid()).toString());
                stored.put("locale", item.locale() == null ? ReleaseLocales.ALL : item.locale());
                Long pinned = item.pin() == null ? null : writes.pinnedVersion(item.assetUuid(), item.pin());
                if (pinned != null) {
                    stored.put("pinnedVersionId", pinned);
                }
                if (Boolean.TRUE.equals(item.deletion())) {
                    stored.put("deletion", true);
                }
            }
            if (schedule.thenGenerate() != null) {
                ObjectNode then = JSON.objectNode();
                putTarget(then, targets.idOf(schedule.thenGenerate().target()));
                ArrayNode channels = then.putArray("channels");
                (schedule.thenGenerate().channels() == null ? List.<String>of() : schedule.thenGenerate().channels())
                        .forEach(channels::add);
                thenGenerate = then;
            }
        }
        if (schedule.comment() != null) {
            params.put("comment", schedule.comment());
        }
        return new ScheduleService.Command(
                schedule.type(),
                schedule.cron() == null ? schedule.runAt() : null,
                schedule.cron(),
                schedule.zoneId(),
                schedule.pinPolicy() == null ? null : PinPolicy.valueOf(schedule.pinPolicy()),
                schedule.missedPolicy() == null ? null : MissedPolicy.valueOf(schedule.missedPolicy()),
                schedule.maxLatenessSeconds() == null ? null : Duration.ofSeconds(schedule.maxLatenessSeconds()),
                thenGenerate,
                params);
    }

    private static void putTarget(ObjectNode node, Long targetId) {
        if (targetId == null) {
            node.putNull("targetId");
        } else {
            node.put("targetId", targetId);
        }
    }

    /** Why a schedule is left out, and the warning it is reported as. */
    private record Skip(ConflictType type, String detail) {

        ImportConflict conflict(ExportedSchedule schedule, String label) {
            return ImportConflict.of(type, schedule.uuid(), label, "Not imported: " + detail);
        }
    }

    private static ImportConflict ownerReplaced(ExportedSchedule schedule, String label, String reason) {
        return ImportConflict.of(ConflictType.SCHEDULE_OWNER_REPLACED, schedule.uuid(), label,
                "Owned by '" + (schedule.ownerUsername() == null ? "a deleted user" : schedule.ownerUsername())
                        + "' in the archive, but " + reason + ": the importing user owns it.");
    }

    private static final DateTimeFormatter AT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'UTC'").withZone(ZoneOffset.UTC);

    /** "Release at 2026-10-01 07:00 UTC (3 items)", "Recurring generation 0 0 3 * * * (Europe/Berlin)". */
    static String label(ExportedSchedule schedule) {
        String type = switch (schedule.type()) {
            case RELEASE -> "Release";
            case UNPUBLISH -> "Unpublish";
            case "GENERATION" -> "Generation";
            case "RECURRING_GENERATION" -> "Recurring generation";
            default -> schedule.type();
        };
        String when = schedule.cron() != null
                ? schedule.cron() + " (" + schedule.zoneId() + ")"
                : "at " + (schedule.runAt() == null ? "?" : AT.format(schedule.runAt()));
        String items = schedule.items() == null
                ? ""
                : " (" + schedule.items().size() + (schedule.items().size() == 1 ? " item)" : " items)");
        String comment = schedule.comment() == null ? "" : ": " + schedule.comment();
        return type + " " + when + items + comment;
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        if (array != null && array.isArray()) {
            array.forEach(value -> out.add(value.asText()));
        }
        return out;
    }
}
