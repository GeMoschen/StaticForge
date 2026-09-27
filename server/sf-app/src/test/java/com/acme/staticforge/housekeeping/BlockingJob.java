package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

/**
 * A test job bean that runs until released (M29.1.1; test sources only): {@link #arm()} before starting it, await
 * {@link #started}, then {@link #release()}. Disabled by default. It also stops when its run is cancelled.
 */
@Component
public class BlockingJob implements HousekeepingJob {

    public static final String KEY = "test-blocking";

    private static final SettingsSpec SETTINGS = SettingsSpec.builder().build();

    private volatile CountDownLatch started = new CountDownLatch(1);
    private volatile CountDownLatch release = new CountDownLatch(0);
    private final AtomicInteger runs = new AtomicInteger();

    /** Makes the next run block until {@link #release()}. */
    public void arm() {
        started = new CountDownLatch(1);
        release = new CountDownLatch(1);
    }

    public boolean awaitStarted() throws InterruptedException {
        return started.await(20, TimeUnit.SECONDS);
    }

    public void release() {
        release.countDown();
    }

    public int runs() {
        return runs.get();
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Test blocking";
    }

    @Override
    public String description() {
        return "Waits until the test releases it.";
    }

    @Override
    public JobDefaults defaults() {
        return new JobDefaults(false, "0 3 * * *", null);
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public JobResult run(JobContext ctx) throws InterruptedException {
        runs.incrementAndGet();
        started.countDown();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (!release.await(50, TimeUnit.MILLISECONDS)) {
            ctx.checkCancelled();
            if (System.nanoTime() > deadline) {
                return JobResult.failed("never released");
            }
        }
        return JobResult.succeeded("released");
    }
}
