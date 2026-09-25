package com.acme.staticforge;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.scheduler.ActionAuthority;
import com.acme.staticforge.scheduler.ActionStatus;
import com.acme.staticforge.scheduler.MissedPolicy;
import com.acme.staticforge.scheduler.PinPolicy;
import com.acme.staticforge.scheduler.ScheduleTiming;
import com.acme.staticforge.scheduler.ScheduledAction;
import com.acme.staticforge.scheduler.ScheduledActionExecution;
import com.acme.staticforge.scheduler.ScheduledActionExecutionRepository;
import com.acme.staticforge.scheduler.ScheduledActionHandler;
import com.acme.staticforge.scheduler.ScheduledActionHandlers;
import com.acme.staticforge.scheduler.ScheduledActionRepository;
import com.acme.staticforge.scheduler.SchedulerConfiguration;
import com.acme.staticforge.scheduler.SchedulerEngine;
import com.acme.staticforge.scheduler.SchedulerProperties;
import com.fasterxml.jackson.databind.JsonNode;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Scheduler test support (M27.4): engines with their own node id and clock over the shared test database (the
 * application's engine doesn't poll in the {@code test} profile), actions written directly, and cleanup.
 *
 * <p>Engine tests run their clocks in the past (2025), so they never claim the future actions other test classes
 * leave behind; {@link #retire} cancels a test's own leftovers so the application engine doesn't pick them up later.
 */
@Component
public class SchedulerFixtures {

    private final ScheduledActionRepository actions;
    private final ScheduledActionExecutionRepository executions;
    private final List<ScheduledActionHandler> handlers;
    private final ActionAuthority authority;
    private final AuditService audit;
    private final PlatformTransactionManager transactionManager;
    private final JdbcTemplate jdbc;

    public SchedulerFixtures(
            ScheduledActionRepository actions,
            ScheduledActionExecutionRepository executions,
            List<ScheduledActionHandler> handlers,
            ActionAuthority authority,
            AuditService audit,
            PlatformTransactionManager transactionManager,
            JdbcTemplate jdbc) {
        this.actions = actions;
        this.executions = executions;
        this.handlers = handlers;
        this.authority = authority;
        this.audit = audit;
        this.transactionManager = transactionManager;
        this.jdbc = jdbc;
    }

    /** An engine as node {@code nodeId} on {@code clock}, with the application's handlers plus {@code extra}. */
    public SchedulerEngine engine(String nodeId, Clock clock, ScheduledActionHandler... extra) {
        List<ScheduledActionHandler> all = new ArrayList<>(handlers);
        all.addAll(List.of(extra));
        SchedulerProperties properties = new SchedulerProperties();
        properties.setBatchSize(100);
        properties.setLease(Duration.ofMinutes(2));
        return new SchedulerEngine(
                actions,
                executions,
                new ScheduledActionHandlers(all),
                authority,
                SchedulerConfiguration.scheduledActionClaimer(jdbc),
                audit,
                transactionManager,
                new SimpleMeterRegistry(),
                properties,
                nodeId,
                clock);
    }

    /** One tick of {@code engine}, waited for; the number of actions it claimed (a waiting action is claimed on every tick). */
    public int tickOnce(SchedulerEngine engine) {
        SchedulerEngine.Tick tick = engine.tick();
        tick.done().join();
        return tick.claimed();
    }

    /** Ticks {@code engine} until it claims nothing more; the number of executions it ran. */
    public int drain(SchedulerEngine engine) {
        int total = 0;
        for (int round = 0; round < 50; round++) {
            SchedulerEngine.Tick tick = engine.tick();
            tick.done().join();
            if (tick.claimed() == 0) {
                return total;
            }
            total += tick.claimed();
        }
        throw new AssertionError("the engine kept claiming actions");
    }

    /** A one-off action due at {@code runAt}, stored as given (no validation). */
    public ScheduledAction oneOff(long projectId, String type, JsonNode params, Instant runAt, long owner) {
        ScheduledAction action = new ScheduledAction(projectId, type, owner, runAt.minus(Duration.ofDays(1)));
        action.setParams(params);
        action.setRunAt(runAt);
        action.setNextRunAt(runAt);
        return actions.save(action);
    }

    /** A recurring action whose first slot is the first after {@code after}. */
    public ScheduledAction recurring(long projectId, String type, JsonNode params, String cron, String zone, Instant after, long owner) {
        ScheduledAction action = new ScheduledAction(projectId, type, owner, after);
        action.setParams(params);
        action.setCron(ScheduleTiming.normalizeCron(cron));
        action.setZoneId(zone);
        action.setNextRunAt(ScheduleTiming.nextAfter(cron, ZoneId.of(zone), after));
        return actions.save(action);
    }

    /** A one-off action from a validated spec (params, pin policy, then generate), due at {@code runAt}. */
    public ScheduledAction oneOff(com.acme.staticforge.scheduler.ActionSpec spec, Instant runAt, long owner) {
        ScheduledAction action = oneOff(spec.projectId(), spec.type(), spec.params(), runAt, owner);
        action.setPinPolicy(spec.pinPolicy());
        action.setThenGenerate(spec.thenGenerate());
        return actions.save(action);
    }

    /** Reopens the last execution and leaves the action as a node that crashed after it would have finished it. */
    public void crashAfterFinishing(long actionId, Instant leaseUntil) {
        jdbc.update("UPDATE scheduled_action_execution SET finished_at = NULL WHERE id = "
                + "(SELECT MAX(id) FROM scheduled_action_execution WHERE action_id = ?)", actionId);
        ScheduledAction action = reload(actionId);
        if (action.getNextRunAt() == null) {
            jdbc.update("UPDATE scheduled_action SET next_run_at = run_at WHERE id = ?", actionId);
        }
        crash(actionId, "dead-node", leaseUntil);
    }

    public ScheduledAction skipIfLaterThan(ScheduledAction action, Duration bound) {
        action.setMissedPolicy(MissedPolicy.SKIP_IF_LATER_THAN);
        action.setMaxLateness(bound);
        return actions.save(action);
    }

    public ScheduledAction pin(ScheduledAction action, PinPolicy policy) {
        action.setPinPolicy(policy);
        return actions.save(action);
    }

    public ScheduledAction save(ScheduledAction action) {
        return actions.save(action);
    }

    public ScheduledAction reload(long actionId) {
        return actions.findById(actionId).orElseThrow();
    }

    /** The executions of an action, oldest first. */
    public List<ScheduledActionExecution> executions(long actionId) {
        List<ScheduledActionExecution> out = new ArrayList<>(
                executions.findByActionIdOrderByIdDesc(actionId, PageRequest.of(0, 500)).getContent());
        java.util.Collections.reverse(out);
        return out;
    }

    /** Leaves {@code actionId} as a crashed node would: {@code RUNNING}, leased by {@code node} until {@code until}. */
    public void crash(long actionId, String node, Instant until) {
        jdbc.update("UPDATE scheduled_action SET status = 'RUNNING', lease_owner = ?, lease_until = ? WHERE id = ?",
                node, java.time.OffsetDateTime.ofInstant(until, java.time.ZoneOffset.UTC), actionId);
    }

    /** Cancels whatever the project still has scheduled. */
    public void retire(long projectId) {
        jdbc.update("UPDATE scheduled_action SET status = ?, next_run_at = NULL, lease_owner = NULL, lease_until = NULL"
                + " WHERE project_id = ? AND status IN (?, ?)",
                ActionStatus.CANCELLED.name(), projectId, ActionStatus.PENDING.name(), ActionStatus.RUNNING.name());
    }
}
