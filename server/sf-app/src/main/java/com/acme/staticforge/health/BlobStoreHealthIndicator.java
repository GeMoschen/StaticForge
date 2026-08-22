package com.acme.staticforge.health;

import com.acme.staticforge.asset.media.MediaProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/**
 * Blob-store health check (spec §26.4). The filesystem backend reports {@code UP} only when
 * its root directory is present and writable; the S3 backend is a v1 placeholder (see
 * {@code S3BlobStore}) and is reported {@code DOWN} so a misconfigured deployment surfaces in
 * {@code /actuator/health} rather than silently writing to the wrong backend.
 */
@Component
public class BlobStoreHealthIndicator implements HealthIndicator {

    private static final String FILESYSTEM = "filesystem";

    private final MediaProperties properties;

    public BlobStoreHealthIndicator(MediaProperties properties) {
        this.properties = properties;
    }

    @Override
    public Health health() {
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
