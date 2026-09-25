package com.acme.staticforge.bootstrap;

import com.acme.staticforge.release.ReleaseStateMigration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Migrates projects created before M27 to the release model at startup (M27.1.1): every non-deleted releasable asset
 * is released at its open version, one revision and one transaction per project (see {@link ReleaseStateMigration}).
 * Once every project is flagged this finds nothing to do and costs one query.
 *
 * <p>A failure is not swallowed: a project left without release state would build nothing once builds render the
 * released state (M27.2), so the application must not come up half migrated.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ReleaseStateInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ReleaseStateInitializer.class);

    private final ReleaseStateMigration migration;

    public ReleaseStateInitializer(ReleaseStateMigration migration) {
        this.migration = migration;
    }

    @Override
    public void run(ApplicationArguments args) {
        List<Long> pending = migration.pendingProjects();
        for (Long projectId : pending) {
            long started = System.nanoTime();
            int pointers = migration.initialize(projectId);
            log.info(
                    "Initial release state of project {}: {} release pointers in {} ms",
                    projectId,
                    pointers,
                    (System.nanoTime() - started) / 1_000_000);
        }
    }
}
