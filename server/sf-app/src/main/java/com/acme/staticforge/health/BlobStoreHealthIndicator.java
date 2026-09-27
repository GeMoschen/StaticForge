package com.acme.staticforge.health;

import com.acme.staticforge.asset.media.MediaProperties;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.blobs.BlobSweepJob;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Blob-store health check (spec §26.4). The filesystem backend reports {@code UP} only when
 * its root directory is present and writable; the S3 backend is a v1 placeholder (see
 * {@code S3BlobStore}) and is reported {@code DOWN} so a misconfigured deployment surfaces in
 * {@code /actuator/health} rather than silently writing to the wrong backend.
 *
 * <p>{@code lastSweep} (M29.2.3) names the newest finished {@code blob-sweep} run: its outcome, end time and whether it
 * was a dry run; absent before the first run. It is informational and never changes the status.
 */
@Component
public class BlobStoreHealthIndicator implements HealthIndicator {

    private static final String FILESYSTEM = "filesystem";

    private final MediaProperties properties;
    private final SystemJobRunRepository jobRuns;

    public BlobStoreHealthIndicator(MediaProperties properties, SystemJobRunRepository jobRuns) {
        this.properties = properties;
        this.jobRuns = jobRuns;
    }

    @Override
    public Health health() {
        Health health = storeHealth();
        Map<String, Object> lastSweep = lastSweep();
        return lastSweep == null ? health : Health.status(health.getStatus())
                .withDetails(health.getDetails())
                .withDetail("lastSweep", lastSweep)
                .build();
    }

    private Map<String, Object> lastSweep() {
        try {
            return jobRuns.findFirstByJobKeyAndFinishedAtIsNotNullOrderByStartedAtDescIdDesc(BlobSweepJob.KEY)
                    .map(run -> {
                        Map<String, Object> detail = new LinkedHashMap<>();
                        detail.put("outcome", String.valueOf(run.getOutcome()));
                        detail.put("finishedAt", run.getFinishedAt().toString());
                        detail.put("dryRun", run.isDryRun());
                        return detail;
                    })
                    .orElse(null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private Health storeHealth() {
        if (!FILESYSTEM.equalsIgnoreCase(properties.getStore())) {
            return Health.down().withDetail("store", properties.getStore()).withDetail("state", "not-implemented").build();
        }

        Path root = Path.of(properties.getRoot() == null ? "./build/media" : properties.getRoot());
        try {
            Files.createDirectories(root);
            boolean writable = Files.isWritable(root);
            return writable
                    ? Health.up().withDetail("root", root.toAbsolutePath().toString()).build()
                    : Health.down().withDetail("root", root.toAbsolutePath().toString()).withDetail("reason", "not-writable").build();
        } catch (Exception e) {
            return Health.down(e).withDetail("root", root.toAbsolutePath().toString()).build();
        }
    }
}
