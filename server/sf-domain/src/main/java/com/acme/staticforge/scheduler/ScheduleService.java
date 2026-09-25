package com.acme.staticforge.scheduler;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectWriteGuard;
import com.acme.staticforge.release.Chunks;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Subquery;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The schedules of a project (M27.4.4): create, edit, cancel, take over, run now, re-pin, and the reads behind the
 * Schedules view. Type-specific rules — validation, what a user needs, which assets an action touches — come from the
 * {@link ScheduledActionHandler}; permissions are the handler's {@link ActionRequirements} evaluated by
 * {@link ActionAuthority} for the caller, the same check the engine applies to the owner before every execution.
 *
 * <p>A change is refused while a node executes the action, or while its execution waits for a busy project
 * ({@code 409 SF-DOM-0167}) — cancel excepted for a waiting one, which ends that execution. Writes allocate no
 * revision, so each checks the archived guard itself ({@code 409 SF-DOM-0141}).
 */
@Service
public class ScheduleService {

    /** Most instants {@link #previewTimes} returns. */
    public static final int MAX_PREVIEW = 10;

    private static final Set<ActionStatus> ACTIVE = EnumSet.of(ActionStatus.PENDING, ActionStatus.RUNNING);
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private final ScheduledActionRepository actions;
    private final ScheduledActionExecutionRepository executions;
    private final ScheduledActionAssetRepository actionAssets;
    private final ScheduledActionHandlers handlers;
    private final ActionAuthority authority;
    private final ProjectWriteGuard writeGuard;
    private final AuditService audit;
    private final Clock clock;

    public ScheduleService(
            ScheduledActionRepository actions,
            ScheduledActionExecutionRepository executions,
            ScheduledActionAssetRepository actionAssets,
            ScheduledActionHandlers handlers,
            ActionAuthority authority,
            ProjectWriteGuard writeGuard,
            AuditService audit,
            Clock clock) {
        this.actions = actions;
        this.executions = executions;
        this.actionAssets = actionAssets;
        this.handlers = handlers;
        this.authority = authority;
        this.writeGuard = writeGuard;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * A create or edit request.
     *
     * @param runAt the one-off time (UTC instant); {@code null} for a recurring type
     * @param cron five- or six-field cron of a recurring type, evaluated in {@code zoneId}
     * @param missedPolicy {@code null} = {@link MissedPolicy#RUN_LATE}
     * @param maxLateness required with {@link MissedPolicy#SKIP_IF_LATER_THAN}
     * @param params the type's params; on an edit {@code null} keeps the stored ones
     */
    public record Command(
            String type,
            Instant runAt,
            String cron,
            String zoneId,
            PinPolicy pinPolicy,
            MissedPolicy missedPolicy,
            Duration maxLateness,
            JsonNode thenGenerate,
            JsonNode params) {}

    /** List filters; {@code null} or empty = any. {@code from}/{@code to} bound {@code next_run_at} ({@code [from, to)}). */
    public record Filter(
            Set<String> types, Set<ActionStatus> statuses, Long ownerUserId, UUID assetUuid, Instant from, Instant to) {}

    /** An action with what it works on and its newest execution. */
    public record Summary(ScheduledAction action, ActionDescription description, ScheduledActionExecution lastExecution) {}

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public Page<Summary> list(long projectId, Filter filter, int page, int size) {
        Sort sort = Sort.by(Sort.Order.asc("nextRunAt").nullsLast(), Sort.Order.desc("id"));
        Page<ScheduledAction> found = actions.findAll(matching(projectId, filter), PageRequest.of(page, size, sort));
        Map<Long, Summary> summaries = new LinkedHashMap<>();
        summarize(found.getContent()).forEach(s -> summaries.put(s.action().getId(), s));
        return found.map(action -> summaries.get(action.getId()));
    }

    @Transactional(readOnly = true)
    public Summary detail(long projectId, long id) {
        return summarize(List.of(require(projectId, id))).get(0);
    }

    @Transactional(readOnly = true)
    public Page<ScheduledActionExecution> executions(long projectId, long id, Pageable pageable) {
        require(projectId, id);
        return executions.findByActionIdOrderByIdDesc(id, pageable);
    }

    /** The next {@code count} (≤ {@value #MAX_PREVIEW}) instants of {@code cron} in {@code zoneId} after now. */
    public List<Instant> previewTimes(String cron, String zoneId, int count) {
        if (count < 1 || count > MAX_PREVIEW) {
            throw new SfException(ProblemFactory.badRequest("count must be between 1 and " + MAX_PREVIEW + ".", "count"));
        }
        String normalized = ScheduleTiming.normalizeCron(cron);
        return ScheduleTiming.next(normalized, ScheduleTiming.zone(zoneId), clock.instant(), count);
    }

    /** The active actions touching each of {@code uuids} (the {@code scheduled} block of asset views): one query. */
    @Transactional(readOnly = true)
    public Map<UUID, List<ScheduledRef>> scheduledFor(long projectId, Collection<UUID> uuids) {
        Map<UUID, List<ScheduledRef>> out = new LinkedHashMap<>();
        if (uuids.isEmpty()) {
            return out;
        }
        Chunks.flatMap(Set.copyOf(uuids), chunk -> actionAssets.findTouching(projectId, chunk, ACTIVE))
                .forEach(ref -> out.computeIfAbsent(ref.assetUuid(), u -> new ArrayList<>()).add(ref));
        return out;
    }

    // ------------------------------------------------------------------
    // Writes
    // ------------------------------------------------------------------

    @Transactional
    public ScheduledAction create(long projectId, Command command, long actorUserId) {
        writeGuard.requireWritable(projectId);
        ScheduledActionHandler handler = handlers.require(command.type());
        Instant now = clock.instant();
        ScheduledAction action = new ScheduledAction(projectId, handler.type(), actorUserId, now);
        ActionSpec spec = apply(action, handler, command, command.params(), actorUserId, now);
        action = actions.save(action);
        writeAssets(action, handler, spec);
        record(action, actorUserId, "SCHEDULE_CREATED", timing(action));
        return action;
    }

    /** Replaces time, policies and params of a {@code PENDING} action read at {@code expectedVersion}. */
    @Transactional
    public ScheduledAction update(long projectId, long id, long expectedVersion, Command command, long actorUserId) {
        writeGuard.requireWritable(projectId);
        ScheduledAction action = require(projectId, id);
        if (action.getVersion() != expectedVersion) {
            throw new SfException(ProblemFactory.conflict(
                    "The schedule was changed by someone else (version " + action.getVersion() + "); reload it."));
        }
        requireIdle(action);
        if (action.getStatus() != ActionStatus.PENDING) {
            throw new SfException(ProblemFactory.conflict("Only a pending schedule can be edited."));
        }
        if (command.type() != null && !command.type().equals(action.getType())) {
            throw SchedulerProblems.invalidParams("The type of a schedule can't change.", "type");
        }
        ScheduledActionHandler handler = handlers.require(action.getType());
        authority.require(projectId, actorUserId, handler.requirements(ActionSpec.of(action)));
        Instant now = clock.instant();
        JsonNode params = command.params() == null ? action.getParams() : command.params();
        ActionSpec spec = apply(action, handler, command, params, actorUserId, now);
        action.setUpdatedAt(now);
        action = actions.saveAndFlush(action);
        writeAssets(action, handler, spec);
        record(action, actorUserId, "SCHEDULE_UPDATED", timing(action));
        return action;
    }

    /** Cancels a pending or paused action; ends an execution that waits for a busy project. */
    @Transactional
    public ScheduledAction cancel(long projectId, long id, long actorUserId) {
        writeGuard.requireWritable(projectId);
        ScheduledAction action = require(projectId, id);
        if (action.getStatus() == ActionStatus.RUNNING) {
            throw SchedulerProblems.running("The schedule is executing right now; cancel it once it has finished.");
        }
        if (action.getStatus() == ActionStatus.CANCELLED) {
            return action;
        }
        if (action.getStatus() != ActionStatus.PENDING && action.getStatus() != ActionStatus.FAILED) {
            throw new SfException(ProblemFactory.conflict("The schedule has already finished."));
        }
        authority.require(projectId, actorUserId, requirements(action));
        Instant now = clock.instant();
        executions.findFirstByActionIdAndFinishedAtIsNullOrderByIdDesc(id).ifPresent(open -> {
            open.setFinishedAt(now);
            open.setMessage((open.getMessage() == null ? "" : open.getMessage() + " ") + "Cancelled while waiting.");
            if (open.getOutcome() == null) {
                open.setOutcome(ExecutionOutcome.SKIPPED);
            }
        });
        action.setStatus(ActionStatus.CANCELLED);
        action.setNextRunAt(null);
        action.setUpdatedAt(now);
        action = actions.saveAndFlush(action);
        record(action, actorUserId, "SCHEDULE_CANCELLED", timing(action));
        return action;
    }

    /**
     * Makes the caller the owner. A paused or failed action becomes {@code PENDING} again: a recurring one at its next
     * slot after now, a one-off at its original time — due at once when that lies in the past, with the missed policy
     * applied to the original time.
     */
    @Transactional
    public ScheduledAction takeOver(long projectId, long id, long actorUserId) {
        writeGuard.requireWritable(projectId);
        ScheduledAction action = require(projectId, id);
        requireIdle(action);
        if (action.getStatus() != ActionStatus.PENDING && action.getStatus() != ActionStatus.FAILED) {
            throw new SfException(ProblemFactory.conflict("Only a pending, paused or failed schedule can be taken over."));
        }
        authority.require(projectId, actorUserId, requirements(action));
        Long previousOwner = action.getOwnerUserId();
        Instant now = clock.instant();
        action.setOwnerUserId(actorUserId);
        if (action.getStatus() == ActionStatus.FAILED) {
            action.setStatus(ActionStatus.PENDING);
            action.setNextRunAt(action.isRecurring()
                    ? ScheduleTiming.nextAfter(action.getCron(), ZoneId.of(action.getZoneId()), now)
                    : action.getRunAt());
        }
        action.setUpdatedAt(now);
        action = actions.saveAndFlush(action);
        ObjectNode detail = timing(action);
        if (previousOwner == null) {
            detail.putNull("previousOwnerId");
        } else {
            detail.put("previousOwnerId", previousOwner);
        }
        record(action, actorUserId, "SCHEDULE_TAKEN_OVER", detail);
        return action;
    }

    /** Makes a pending action due now: a one-off runs now instead of later; a recurring one keeps its schedule. */
    @Transactional
    public ScheduledAction runNow(long projectId, long id, long actorUserId) {
        writeGuard.requireWritable(projectId);
        ScheduledAction action = require(projectId, id);
        requireIdle(action);
        if (action.getStatus() != ActionStatus.PENDING) {
            throw new SfException(ProblemFactory.conflict(
                    "Only a pending schedule can run now; take over a paused or failed one first."));
        }
        authority.require(projectId, actorUserId, requirements(action));
        Instant now = clock.instant();
        if (!action.isRecurring()) {
            action.setRunAt(now);
        }
        action.setNextRunAt(now);
        action.setUpdatedAt(now);
        action = actions.saveAndFlush(action);
        record(action, actorUserId, "SCHEDULE_RUN_NOW", timing(action));
        return action;
    }

    /** Pins a pending scheduled release to the current drafts ({@code 422 SF-DOM-0168} for anything else). */
    @Transactional
    public ScheduledAction repin(long projectId, long id, long actorUserId) {
        writeGuard.requireWritable(projectId);
        ScheduledAction action = require(projectId, id);
        requireIdle(action);
        if (action.getStatus() != ActionStatus.PENDING) {
            throw new SfException(ProblemFactory.conflict("Only a pending schedule can be re-pinned."));
        }
        ScheduledActionHandler handler = handlers.require(action.getType());
        authority.require(projectId, actorUserId, handler.requirements(ActionSpec.of(action)));
        action.setParams(handler.repin(ActionSpec.of(action), actorUserId));
        action.setUpdatedAt(clock.instant());
        action = actions.saveAndFlush(action);
        writeAssets(action, handler, ActionSpec.of(action));
        ObjectNode detail = timing(action);
        detail.put("repinned", true);
        record(action, actorUserId, "SCHEDULE_UPDATED", detail);
        return action;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Validates {@code command} for {@code handler} and writes timing, policies and the normalized spec onto {@code action}. */
    private ActionSpec apply(
            ScheduledAction action, ScheduledActionHandler handler, Command command, JsonNode params, long actorUserId, Instant now) {
        boolean recurring = handler.timing() == ScheduledActionHandler.Timing.RECURRING;
        Instant nextRunAt;
        if (recurring) {
            if (command.runAt() != null) {
                throw SchedulerProblems.timingMismatch("A recurring " + handler.type() + " runs on a cron, not at runAt.");
            }
            String cron = ScheduleTiming.normalizeCron(command.cron());
            ZoneId zone = ScheduleTiming.zone(command.zoneId());
            nextRunAt = ScheduleTiming.nextAfter(cron, zone, now);
            if (nextRunAt == null) {
                throw SchedulerProblems.invalidCron("The cron expression never matches.", "cron");
            }
            action.setCron(cron);
            action.setZoneId(zone.getId());
            action.setRunAt(null);
        } else {
            if (command.cron() != null && !command.cron().isBlank()) {
                throw SchedulerProblems.timingMismatch("A " + handler.type() + " runs once at runAt; it takes no cron.");
            }
            if (command.runAt() == null) {
                throw SchedulerProblems.timingMismatch("A " + handler.type() + " needs runAt.");
            }
            if (command.runAt().isBefore(now)) {
                throw SchedulerProblems.timeInPast();
            }
            nextRunAt = command.runAt();
            action.setRunAt(command.runAt());
            action.setCron(null);
            action.setZoneId(command.zoneId() == null || command.zoneId().isBlank() ? null : ScheduleTiming.zone(command.zoneId()).getId());
        }
        MissedPolicy missed = command.missedPolicy() == null ? MissedPolicy.RUN_LATE : command.missedPolicy();
        Duration maxLateness = null;
        if (missed == MissedPolicy.SKIP_IF_LATER_THAN) {
            if (command.maxLateness() == null || command.maxLateness().isNegative() || command.maxLateness().isZero()) {
                throw SchedulerProblems.invalidParams("SKIP_IF_LATER_THAN needs a positive maxLateness.", "maxLateness");
            }
            maxLateness = command.maxLateness();
        }
        ActionSpec draft = new ActionSpec(
                action.getProjectId(), action.getId(), handler.type(), params, command.pinPolicy(), command.thenGenerate(), recurring);
        authority.require(action.getProjectId(), actorUserId, handler.requirements(draft));
        ActionSpec spec = handler.validate(draft, actorUserId);
        authority.require(action.getProjectId(), actorUserId, handler.requirements(spec));
        action.setParams(spec.params());
        action.setPinPolicy(spec.pinPolicy());
        action.setThenGenerate(spec.thenGenerate());
        action.setMissedPolicy(missed);
        action.setMaxLateness(maxLateness);
        action.setNextRunAt(nextRunAt);
        return spec;
    }

    private void writeAssets(ScheduledAction action, ScheduledActionHandler handler, ActionSpec spec) {
        actionAssets.deleteByActionId(action.getId());
        actionAssets.flush();
        List<ScheduledActionAsset> rows = handler.assets(spec).stream()
                .map(a -> new ScheduledActionAsset(action.getId(), action.getProjectId(), a.assetUuid(), a.locale()))
                .toList();
        actionAssets.saveAll(rows);
    }

    private ScheduledAction require(long projectId, long id) {
        return actions.findById(id)
                .filter(a -> a.getProjectId() == projectId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Schedule not found.")));
    }

    /** {@code 409 SF-DOM-0167} while a node executes the action or its execution waits for a busy project. */
    private void requireIdle(ScheduledAction action) {
        if (action.getStatus() == ActionStatus.RUNNING) {
            throw SchedulerProblems.running("The schedule is executing right now.");
        }
        if (executions.findFirstByActionIdAndFinishedAtIsNullOrderByIdDesc(action.getId()).isPresent()) {
            throw SchedulerProblems.running("The schedule is executing and waits for a generation run; cancel it instead.");
        }
    }

    private ActionRequirements requirements(ScheduledAction action) {
        return handlers.find(action.getType())
                .map(h -> h.requirements(ActionSpec.of(action)))
                .orElse(ActionRequirements.role(com.acme.staticforge.project.ProjectRole.DEVELOPER));
    }

    private List<Summary> summarize(List<ScheduledAction> page) {
        if (page.isEmpty()) {
            return List.of();
        }
        Map<Long, ActionDescription> descriptions = new LinkedHashMap<>();
        Map<String, List<ActionSpec>> byType = new LinkedHashMap<>();
        page.forEach(a -> byType.computeIfAbsent(a.getType(), t -> new ArrayList<>()).add(ActionSpec.of(a)));
        byType.forEach((type, specs) -> handlers.find(type).ifPresent(h -> descriptions.putAll(h.describe(specs))));
        Map<Long, ScheduledActionExecution> last = new LinkedHashMap<>();
        executions.findLatest(page.stream().map(ScheduledAction::getId).toList())
                .forEach(e -> last.put(e.getActionId(), e));
        return page.stream()
                .map(a -> new Summary(a, descriptions.getOrDefault(a.getId(), ActionDescription.NONE), last.get(a.getId())))
                .toList();
    }

    private static Specification<ScheduledAction> matching(long projectId, Filter filter) {
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();
            where.add(cb.equal(root.get("projectId"), projectId));
            if (filter.types() != null && !filter.types().isEmpty()) {
                where.add(root.get("type").in(filter.types()));
            }
            if (filter.statuses() != null && !filter.statuses().isEmpty()) {
                where.add(root.get("status").in(filter.statuses()));
            }
            if (filter.ownerUserId() != null) {
                where.add(cb.equal(root.get("ownerUserId"), filter.ownerUserId()));
            }
            if (filter.from() != null) {
                where.add(cb.greaterThanOrEqualTo(root.get("nextRunAt"), filter.from()));
            }
            if (filter.to() != null) {
                where.add(cb.lessThan(root.get("nextRunAt"), filter.to()));
            }
            if (filter.assetUuid() != null) {
                Subquery<Long> touching = query.subquery(Long.class);
                var asset = touching.from(ScheduledActionAsset.class);
                touching.select(asset.get("actionId"))
                        .where(cb.equal(asset.get("assetUuid"), filter.assetUuid()));
                where.add(root.get("id").in(touching));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
    }

    private static ObjectNode timing(ScheduledAction action) {
        ObjectNode detail = JSON.objectNode();
        detail.put("actionId", action.getId());
        detail.put("type", action.getType());
        if (action.getRunAt() != null) {
            detail.put("runAt", action.getRunAt().toString());
        }
        if (action.getCron() != null) {
            detail.put("cron", action.getCron());
            detail.put("zoneId", action.getZoneId());
        }
        if (action.getNextRunAt() != null) {
            detail.put("nextRunAt", action.getNextRunAt().toString());
        }
        return detail;
    }

    private void record(ScheduledAction action, long actorUserId, String auditAction, ObjectNode detail) {
        audit.record(action.getProjectId(), actorUserId, auditAction, "schedule:" + action.getId(), detail);
    }
}
