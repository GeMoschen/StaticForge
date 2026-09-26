package com.acme.staticforge.scheduler;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.publish.PublishPermissionEvaluator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Executes due scheduled actions (M27.4.1, epic decisions 20, 23–27). Every {@code poll-interval} a node reads the
 * due actions of non-archived projects and claims each with {@link LeaseClaimer}; only the node whose conditional
 * update won executes it, on a virtual thread, extending the lease while it runs. A node that dies mid-execution
 * leaves a {@code RUNNING} action whose lease expires; another node claims it and resumes the open execution.
 *
 * <p>Per execution the engine applies, in order: an unknown type fails ({@code SF-DOM-0160}, paused); a new
 * execution later than a {@code SKIP_IF_LATER_THAN} bound is {@code SKIPPED}; an owner who lost the permission fails
 * it ({@code SF-DOM-0163}, paused); otherwise the handler runs as the owner. A {@code WAITING} result keeps the
 * execution open and the action due, so it is retried on the next tick. A finished recurring action is due again at
 * its next slot <em>after now</em>, so slots missed while the system was down collapse into one execution.
 *
 * <p>A plain class rather than a component so tests can run several engines (node ids, clocks) against one database;
 * {@link SchedulerConfiguration} makes the application's instance. All time comes from the injected {@link Clock}.
 */
public class SchedulerEngine implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(SchedulerEngine.class);
    private static final Set<ActionStatus> CLAIMABLE = EnumSet.of(ActionStatus.PENDING, ActionStatus.RUNNING);

    private final ScheduledActionRepository actions;
    private final ScheduledActionExecutionRepository executions;
    private final ScheduledActionHandlers handlers;
    private final ActionAuthority authority;
    private final LeaseClaimer claimer;
    private final AuditService audit;
    private final TransactionTemplate tx;
    private final MeterRegistry meters;
    private final SchedulerProperties properties;
    private final String nodeId;
    private final Clock clock;

    private final Counter claims;
    private final Timer lag;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final ScheduledExecutorService leaseKeeper = Executors.newSingleThreadScheduledExecutor(
            Thread.ofPlatform().name("sf-scheduler-lease").daemon().factory());
    private final Set<Long> reportedUnknown = ConcurrentHashMap.newKeySet();
    private ScheduledExecutorService poller;

    public SchedulerEngine(
            ScheduledActionRepository actions,
            ScheduledActionExecutionRepository executions,
            ScheduledActionHandlers handlers,
            ActionAuthority authority,
            LeaseClaimer claimer,
            AuditService audit,
            PlatformTransactionManager transactionManager,
            MeterRegistry meters,
            SchedulerProperties properties,
            String nodeId,
            Clock clock) {
        this.actions = actions;
        this.executions = executions;
        this.handlers = handlers;
        this.authority = authority;
        this.claimer = claimer;
        this.audit = audit;
        this.tx = new TransactionTemplate(transactionManager);
        this.meters = meters;
        this.properties = properties;
        this.nodeId = nodeId;
        this.clock = clock;
        this.claims = Counter.builder("sf.scheduler.claims")
                .description("Scheduled actions this node claimed")
                .register(meters);
        this.lag = Timer.builder("sf.scheduler.lag")
                .description("How late scheduled actions started")
                .register(meters);
    }

    /** One poll: how many due actions this node claimed, and a future completing when they have all been handled. */
    public record Tick(int claimed, CompletableFuture<Void> done) {}

    public String nodeId() {
        return nodeId;
    }

    /** Starts polling every {@code poll-interval}; idempotent. */
    public synchronized void start() {
        if (poller != null) {
            return;
        }
        long interval = Math.max(1, properties.getPollInterval().toMillis());
        poller = Executors.newSingleThreadScheduledExecutor(
                Thread.ofPlatform().name("sf-scheduler-tick").daemon().factory());
        poller.scheduleWithFixedDelay(this::pollSafely, interval, interval, TimeUnit.MILLISECONDS);
        log.info("Scheduler started on node {} (poll every {} ms)", nodeId, interval);
    }

    @Override
    public synchronized void close() {
        if (poller != null) {
            poller.shutdownNow();
            poller = null;
        }
        leaseKeeper.shutdownNow();
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }

    private void pollSafely() {
        try {
            tick();
        } catch (RuntimeException e) {
            log.warn("Scheduler poll failed on node {}", nodeId, e);
        }
    }

    /** Claims the due actions and executes each claimed one on its own virtual thread. */
    public Tick tick() {
        Instant now = clock.instant();
        List<ScheduledAction> due = actions.findDue(now, CLAIMABLE, PageRequest.of(0, Math.max(1, properties.getBatchSize())));
        List<CompletableFuture<Void>> running = new ArrayList<>();
        for (ScheduledAction action : due) {
            if (!claimer.claim(action.getId(), action.getVersion(), nodeId, now.plus(properties.getLease()), now)) {
                continue;
            }
            claims.increment();
            long id = action.getId();
            running.add(CompletableFuture.runAsync(() -> runClaimed(id), executor));
        }
        return new Tick(running.size(), CompletableFuture.allOf(running.toArray(CompletableFuture[]::new)));
    }

    // ------------------------------------------------------------------
    // One claimed action
    // ------------------------------------------------------------------

    /** The claimed action and the execution this attempt works on. */
    private record Attempt(
            ActionSpec spec,
            long ownerUserId,
            MissedPolicy missedPolicy,
            Duration maxLateness,
            long executionId,
            Instant scheduledFor,
            boolean fresh,
            ObjectNode progress) {}

    private void runClaimed(long actionId) {
        try {
            Attempt attempt = tx.execute(status -> begin(actionId));
            if (attempt == null) {
                return;
            }
            long period = Math.max(1000, properties.getLease().toMillis() / 3);
            ScheduledFuture<?> keeper = leaseKeeper.scheduleAtFixedRate(
                    () -> extendLease(actionId), period, period, TimeUnit.MILLISECONDS);
            ExecutionResult result;
            try {
                result = decide(attempt);
            } catch (RuntimeException e) {
                log.warn("Scheduled action {} failed", actionId, e);
                result = failure(e);
            } finally {
                keeper.cancel(false);
            }
            ExecutionResult outcome = result;
            tx.executeWithoutResult(status -> finish(actionId, attempt, outcome));
        } catch (RuntimeException e) {
            // The lease expires and another tick retries; the open execution keeps what was done.
            log.error("Scheduler could not record action {} on node {}", actionId, nodeId, e);
        }
    }

    /** Loads the claimed action and opens its execution, or resumes the one left open. */
    private Attempt begin(long actionId) {
        ScheduledAction action = actions.findById(actionId).orElse(null);
        if (action == null || !nodeId.equals(action.getLeaseOwner())) {
            return null;
        }
        Instant now = clock.instant();
        Optional<ScheduledActionExecution> open = executions.findFirstByActionIdAndFinishedAtIsNullOrderByIdDesc(actionId);
        ScheduledActionExecution execution;
        boolean fresh = open.isEmpty();
        if (fresh) {
            Instant scheduledFor = action.getNextRunAt() == null ? now : action.getNextRunAt();
            execution = executions.save(new ScheduledActionExecution(
                    actionId, scheduledFor, now, lateness(scheduledFor, now).toMillis(), action.getOwnerUserId()));
        } else {
            execution = open.get();
            execution.setExecutedAsUserId(action.getOwnerUserId());
        }
        ObjectNode progress = execution.getDetail() instanceof ObjectNode detail
                ? detail.deepCopy()
                : JsonNodeFactory.instance.objectNode();
        return new Attempt(
                ActionSpec.of(action),
                action.getOwnerUserId(),
                action.getMissedPolicy(),
                action.getMaxLateness(),
                execution.getId(),
                execution.getScheduledFor(),
                fresh,
                progress);
    }

    private ExecutionResult decide(Attempt attempt) {
        long actionId = attempt.spec().actionId();
        Optional<ScheduledActionHandler> handler = handlers.find(attempt.spec().type());
        if (handler.isEmpty()) {
            if (reportedUnknown.add(actionId)) {
                log.error("Scheduled action {} has unknown type '{}'; it is paused", actionId, attempt.spec().type());
            }
            return ExecutionResult.failedAndPause(
                    SchedulerProblems.UNKNOWN_TYPE, "Unknown action type '" + attempt.spec().type() + "'.");
        }
        Duration lateBy = lateness(attempt.scheduledFor(), clock.instant());
        if (attempt.fresh() && boundPassed(attempt, lateBy)) {
            return ExecutionResult.skipped("Skipped: " + human(lateBy) + " late, the limit is "
                    + human(attempt.maxLateness()) + ".");
        }
        Optional<PublishPermissionEvaluator.Denial> denial = authority.check(
                attempt.spec().projectId(), attempt.ownerUserId(), handler.get().requirements(attempt.spec()));
        if (denial.isPresent()) {
            // "Owner no longer permitted (SCHEDULE_RELEASE): 'bob' is EDITOR without SCHEDULE_RELEASE …" (M28.2.1).
            String missing = denial.get().missing() == null ? "" : " (" + denial.get().missing() + ")";
            return ExecutionResult.failedAndPause(SchedulerProblems.OWNER_NOT_PERMITTED,
                    "Owner no longer permitted" + missing + ": " + denial.get().reason() + ".");
        }
        return handler.get().execute(new Context(attempt));
    }

    private void finish(long actionId, Attempt attempt, ExecutionResult result) {
        ScheduledAction action = actions.findById(actionId).orElse(null);
        if (action == null) {
            return;
        }
        if (!nodeId.equals(action.getLeaseOwner())) {
            log.warn("Node {} lost the lease of scheduled action {} while executing it; the result is dropped",
                    nodeId, actionId);
            return;
        }
        ScheduledActionExecution execution = executions.findById(attempt.executionId()).orElseThrow();
        Instant now = clock.instant();
        execution.setMessage(result.message());
        execution.setOutcome(result.outcome());
        execution.setDetail(merge(execution.getDetail(), result.detail()));
        action.clearLease();
        if (result.isWaiting()) {
            // Still due: the next tick retries the open execution (epic decision 27).
            action.setStatus(ActionStatus.PENDING);
            return;
        }
        execution.setFinishedAt(now);
        if (action.isRecurring()) {
            if (result.pause()) {
                action.setStatus(ActionStatus.FAILED);
                action.setNextRunAt(null);
            } else {
                Instant next = ScheduleTiming.nextAfter(action.getCron(), ZoneId.of(action.getZoneId()), now);
                action.setStatus(next == null ? ActionStatus.SUCCEEDED : ActionStatus.PENDING);
                action.setNextRunAt(next);
            }
        } else {
            action.setStatus(switch (result.outcome()) {
                case SUCCEEDED, PARTIAL -> ActionStatus.SUCCEEDED;
                case FAILED -> ActionStatus.FAILED;
                case SKIPPED -> ActionStatus.SKIPPED;
            });
            action.setNextRunAt(null);
        }
        record(action, execution);
    }

    private void record(ScheduledAction action, ScheduledActionExecution execution) {
        ExecutionOutcome outcome = execution.getOutcome();
        ObjectNode detail = JsonNodeFactory.instance.objectNode();
        detail.put("actionId", action.getId());
        detail.put("type", action.getType());
        detail.put("lateByMs", execution.getLateByMs());
        detail.put("outcome", outcome.name());
        String auditAction = switch (outcome) {
            case SUCCEEDED, PARTIAL -> "SCHEDULE_EXECUTED";
            case FAILED -> "SCHEDULE_FAILED";
            case SKIPPED -> "SCHEDULE_SKIPPED";
        };
        audit.record(action.getProjectId(), action.getOwnerUserId(), auditAction, "schedule:" + action.getId(), detail);
        Counter.builder("sf.scheduler.executions")
                .description("Finished scheduled action executions")
                .tag("type", action.getType())
                .tag("outcome", outcome.name())
                .register(meters)
                .increment();
        lag.record(Duration.ofMillis(execution.getLateByMs()));
    }

    private void extendLease(long actionId) {
        try {
            if (!claimer.extend(actionId, nodeId, clock.instant().plus(properties.getLease()))) {
                log.warn("Node {} no longer holds the lease of scheduled action {}", nodeId, actionId);
            }
        } catch (RuntimeException e) {
            log.warn("Could not extend the lease of scheduled action {}", actionId, e);
        }
    }

    private static ExecutionResult failure(RuntimeException e) {
        if (e instanceof SfException sf && sf.getProblem() != null) {
            Object code = sf.getProblem().getExtensions().get("code");
            return ExecutionResult.failed(code == null ? null : code.toString(), sf.getProblem().getDetail());
        }
        return ExecutionResult.failed(null, "Unexpected error: " + e.getMessage());
    }

    private static boolean boundPassed(Attempt attempt, Duration lateBy) {
        return attempt.missedPolicy() == MissedPolicy.SKIP_IF_LATER_THAN
                && attempt.maxLateness() != null
                && lateBy.compareTo(attempt.maxLateness()) > 0;
    }

    private static Duration lateness(Instant scheduledFor, Instant now) {
        Duration late = Duration.between(scheduledFor, now);
        return late.isNegative() ? Duration.ZERO : late;
    }

    private static JsonNode merge(JsonNode progress, JsonNode result) {
        if (result == null || result.isEmpty()) {
            return progress;
        }
        ObjectNode merged = progress instanceof ObjectNode object ? object.deepCopy() : JsonNodeFactory.instance.objectNode();
        if (result instanceof ObjectNode object) {
            merged.setAll(object);
        }
        return merged;
    }

    /** {@code 1h 5m}, {@code 30s}. */
    static String human(Duration duration) {
        if (duration == null) {
            return "none";
        }
        long seconds = duration.toSeconds();
        if (seconds < 60) {
            return seconds + "s";
        }
        long minutes = seconds / 60;
        if (minutes < 60) {
            return minutes + "m" + (seconds % 60 == 0 ? "" : " " + seconds % 60 + "s");
        }
        long hours = minutes / 60;
        return hours + "h" + (minutes % 60 == 0 ? "" : " " + minutes % 60 + "m");
    }

    // ------------------------------------------------------------------
    // Handler view of one attempt
    // ------------------------------------------------------------------

    private final class Context implements ExecutionContext {

        private final Attempt attempt;
        private ObjectNode progress;

        Context(Attempt attempt) {
            this.attempt = attempt;
            this.progress = attempt.progress();
        }

        @Override
        public ActionSpec spec() {
            return attempt.spec();
        }

        @Override
        public long actionId() {
            return attempt.spec().actionId();
        }

        @Override
        public long executionId() {
            return attempt.executionId();
        }

        @Override
        public Instant scheduledFor() {
            return attempt.scheduledFor();
        }

        @Override
        public Instant now() {
            return clock.instant();
        }

        @Override
        public Duration lateBy() {
            return lateness(attempt.scheduledFor(), clock.instant());
        }

        @Override
        public boolean latenessBoundPassed() {
            return boundPassed(attempt, lateBy());
        }

        @Override
        public long ownerUserId() {
            return attempt.ownerUserId();
        }

        @Override
        public ObjectNode progress() {
            return progress.deepCopy();
        }

        @Override
        public void checkpoint(ObjectNode next, Long revisionId, Long generationRunId) {
            ScheduledActionExecution execution = executions.findById(attempt.executionId()).orElseThrow();
            execution.setDetail(next.deepCopy());
            if (revisionId != null) {
                execution.setRevisionId(revisionId);
            }
            if (generationRunId != null) {
                execution.setGenerationRunId(generationRunId);
            }
            executions.save(execution);
            progress = next.deepCopy();
        }
    }
}
