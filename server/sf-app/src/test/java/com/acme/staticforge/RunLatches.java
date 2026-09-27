package com.acme.staticforge;

import com.acme.staticforge.generate.GenerationRunProbe;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/**
 * A latch in the generation pipeline (M29.2.1; test sources only): {@link #arm} a gate for a project and a point, and
 * the project's next run blocks there on its executing thread until the test {@link Gate#release()}s it — so a test
 * can cancel a run while it renders, or race a cancel against the final status write. Inert while nothing is armed.
 */
@Component
public class RunLatches implements GenerationRunProbe {

    private static final long MAX_HOLD_SECONDS = 30;

    private final Map<String, Gate> gates = new ConcurrentHashMap<>();

    /** Holds runs of {@code projectId} at {@code point} until the returned gate is released. */
    public Gate arm(long projectId, String point) {
        Gate gate = new Gate();
        gates.put(projectId + "@" + point, gate);
        return gate;
    }

    /** Stops holding runs of {@code projectId} at {@code point} (a released gate lets everything through anyway). */
    public void disarm(long projectId, String point) {
        Gate gate = gates.remove(projectId + "@" + point);
        if (gate != null) {
            gate.release();
        }
    }

    @Override
    public void reached(long projectId, long runId, String point) {
        Gate gate = gates.get(projectId + "@" + point);
        if (gate != null) {
            gate.pass(runId);
        }
    }

    /** One armed point: records the first run that arrives and holds every arrival until released. */
    public static final class Gate {

        private final CountDownLatch arrived = new CountDownLatch(1);
        private final CountDownLatch released = new CountDownLatch(1);
        private volatile long runId = -1;

        private void pass(long run) {
            if (runId < 0) {
                runId = run;
            }
            arrived.countDown();
            try {
                released.await(MAX_HOLD_SECONDS, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }

        /** Waits until a run is held here; its id. */
        public long awaitArrival() throws InterruptedException {
            if (!arrived.await(MAX_HOLD_SECONDS, TimeUnit.SECONDS)) {
                throw new AssertionError("No run reached the gate within " + MAX_HOLD_SECONDS + "s");
            }
            return runId;
        }

        public void release() {
            released.countDown();
        }
    }
}
