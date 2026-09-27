package com.acme.staticforge.generate;

import com.acme.staticforge.generate.pipeline.RunAbortedException;
import com.acme.staticforge.node.NodeIdentity;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The executing side of generation runs on this node (M29.2.1, epic decision 9): which runs this node's executor holds,
 * their heartbeat, the stop checks, and the locked status writes.
 *
 * <ul>
 *   <li><b>Held runs.</b> A run is held from the moment it is queued (before its row commits) until its executor has
 *       written the final status. The recovery job never touches a held run, whatever its heartbeat says (a long GC
 *       pause must not fail a live run), and treats an active run of this node that is <em>not</em> held as dead.
 *   <li><b>Heartbeat.</b> {@code heartbeat_at} is refreshed at every stage and every {@code sf.generate.heartbeat-
 *       interval} by a targeted update in its own transaction. An update that finds the run no longer
 *       {@code RUNNING} marks it aborted.
 *   <li><b>Stopping.</b> {@link #checkpoint} (each page) checks an in-memory flag, set by {@link #abort} (a cancel on
 *       this node) or a failed heartbeat; {@link #stage} also re-reads the row through the heartbeat. Both throw
 *       {@link RunAbortedException}.
 *   <li><b>Status writes.</b> {@link #whileRunning} and {@link #whileActive} change a run on its row locked
 *       ({@code SELECT … FOR UPDATE}) only while it is still in the expected state — a compare-and-set that also
 *       serializes the final write <em>with its publish</em> against a cancel: whichever commits first wins, and the
 *       other sees it. A run is therefore never published or marked {@code SUCCESS} after {@code CANCELLED} committed.
 * </ul>
 */
@Component
public class GenerationRunControl implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(GenerationRunControl.class);

    private final GenerationRunRepository runs;
    private final TransactionTemplate tx;
    private final NodeIdentity node;
    private final Duration heartbeatInterval;
    private final ObjectProvider<GenerationRunProbe> probes;
    private final ScheduledExecutorService heartbeats = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "sf-generation-heartbeat");
        thread.setDaemon(true);
        return thread;
    });
    private final Map<Long, Held> held = new ConcurrentHashMap<>();
    /** The probe beans, looked up once on first use (the render loop calls {@link #checkpoint} per page). */
    private volatile List<GenerationRunProbe> probeList;

    @PersistenceContext
    private EntityManager entityManager;

    public GenerationRunControl(
            GenerationRunRepository runs,
            PlatformTransactionManager transactionManager,
            NodeIdentity node,
            GenerationProperties properties,
            ObjectProvider<GenerationRunProbe> probes) {
        this.runs = runs;
        this.tx = new TransactionTemplate(transactionManager);
        this.node = node;
        Duration interval = properties.getHeartbeatInterval();
        this.heartbeatInterval = interval == null || interval.isNegative() || interval.isZero()
                ? Duration.ofSeconds(15)
                : interval;
        this.probes = probes;
    }

    /** One run held by this node's executor. */
    private static final class Held {
        final long projectId;
        volatile boolean aborted;
        volatile ScheduledFuture<?> heartbeat;

        Held(long projectId) {
            this.projectId = projectId;
        }
    }

    /** This node's id ({@code sf.node-id}), recorded as the run's {@code executor_node}. */
    public String nodeId() {
        return node.id();
    }

    /** Whether this node's executor holds {@code runId} (queued here and not finished yet). */
    public boolean isHeld(long runId) {
        return held.containsKey(runId);
    }

    /** The runs this node's executor holds now. */
    public Set<Long> heldRuns() {
        return Set.copyOf(held.keySet());
    }

    /** From queuing on: {@code runId} is this node's until {@link #release}. */
    void hold(long runId, long projectId) {
        held.putIfAbsent(runId, new Held(projectId));
    }

    /** The executor is done with {@code runId}: its final status is written (or never will be by this node). */
    void release(long runId) {
        Held run = held.remove(runId);
        if (run != null && run.heartbeat != null) {
            run.heartbeat.cancel(false);
        }
    }

    /** Tells the executor of {@code runId}, if it runs here, to stop at its next checkpoint (after a cancel committed). */
    void abort(long runId) {
        Held run = held.get(runId);
        if (run != null) {
            run.aborted = true;
        }
    }

    /**
     * {@code QUEUED} → {@code RUNNING} as this node, with the first heartbeat, and starts the periodic heartbeat.
     *
     * @return {@code false} when the run was no longer queued (cancelled or recovered before it started)
     */
    boolean markRunning(long runId) {
        if (runs.markRunning(runId, node.id(), Instant.now()) == 0) {
            return false;
        }
        Held run = held.get(runId);
        if (run != null) {
            long millis = heartbeatInterval.toMillis();
            run.heartbeat = heartbeats.scheduleWithFixedDelay(() -> beat(runId), millis, millis, TimeUnit.MILLISECONDS);
        }
        return true;
    }

    /** A stage begins: probes, then the heartbeat (which re-reads the status) and the stop check. */
    void stage(long runId, String stage) {
        probe(runId, stage);
        beat(runId);
        stopIfAborted(runId);
    }

    /** A point inside a stage (each page of the render loop, the moment before publishing): probes and the stop check. */
    void checkpoint(long runId, String point) {
        probe(runId, point);
        stopIfAborted(runId);
    }

    /**
     * Applies {@code change} to run {@code runId} on its locked row if it is still {@code RUNNING}, in one transaction
     * (joined when one is active). Whatever {@code change} does — the final write publishes inside it — happens only
     * while no cancel or recovery can commit in between.
     *
     * @return the changed run, or empty when the run is no longer running (nothing is changed)
     */
    Optional<GenerationRun> whileRunning(long runId, Consumer<GenerationRun> change) {
        return whileActive(runId, run -> run.getStatus() == RunStatus.RUNNING, change);
    }

    /**
     * Applies {@code change} to run {@code runId} on its locked row if it is still {@code QUEUED}/{@code RUNNING} and
     * {@code condition} holds for its fresh state, in one transaction (joined when one is active).
     *
     * @return the changed run, or empty when the run finished meanwhile or {@code condition} is false
     */
    Optional<GenerationRun> whileActive(long runId, Predicate<GenerationRun> condition, Consumer<GenerationRun> change) {
        return Optional.ofNullable(tx.execute(status -> {
            GenerationRun run = entityManager.find(GenerationRun.class, runId);
            if (run == null) {
                return null;
            }
            // Re-read under the lock: the entity may have been loaded (stale) earlier in this persistence context.
            entityManager.refresh(run, LockModeType.PESSIMISTIC_WRITE);
            if (run.getStatus().isTerminal() || !condition.test(run)) {
                return null;
            }
            change.accept(run);
            entityManager.flush();
            return run;
        }));
    }

    @Override
    public void destroy() {
        heartbeats.shutdownNow();
    }

    /** Refreshes the heartbeat; a run found no longer {@code RUNNING} is marked aborted. */
    private void beat(long runId) {
        try {
            if (runs.heartbeat(runId, Instant.now()) == 0) {
                abort(runId);
            }
        } catch (RuntimeException e) {
            // A slow database (a lock held by a publish) must not fail the run; the next beat retries.
            log.warn("Heartbeat of generation run {} failed: {}", runId, e.getMessage());
        }
    }

    private void probe(long runId, String point) {
        Held run = held.get(runId);
        if (run == null) {
            return;
        }
        List<GenerationRunProbe> list = probeList;
        if (list == null) {
            list = probes.orderedStream().toList();
            probeList = list;
        }
        for (GenerationRunProbe probe : list) {
            probe.reached(run.projectId, runId, point);
        }
    }

    private void stopIfAborted(long runId) {
        Held run = held.get(runId);
        if (run != null && run.aborted) {
            throw new RunAbortedException(runId);
        }
    }
}
