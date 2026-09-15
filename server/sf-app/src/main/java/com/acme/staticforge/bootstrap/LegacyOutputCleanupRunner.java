package com.acme.staticforge.bootstrap;

import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.target.LegacyOutputCleanup;
import com.acme.staticforge.project.ProjectRepository;
import java.nio.file.Path;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Removes generated output left in the shared output root by the pre-per-target layout (spec
 * §18.4, {@link LegacyOutputCleanup}) once at startup. Disable with
 * {@code sf.generate.cleanup-legacy-output=false}.
 */
@Component
public class LegacyOutputCleanupRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(LegacyOutputCleanupRunner.class);

    private final GenerationProperties properties;
    private final ProjectRepository projects;

    public LegacyOutputCleanupRunner(GenerationProperties properties, ProjectRepository projects) {
        this.properties = properties;
        this.projects = projects;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!properties.isCleanupLegacyOutput()) {
            return;
        }
        Path outputRoot = Path.of(properties.getOutputRoot());
        try {
            List<Path> removed = LegacyOutputCleanup.run(outputRoot, projects::existsByKey);
            removed.forEach(path -> log.info("Removed legacy generation output {}", path));
        } catch (RuntimeException e) {
            // Cleanup is housekeeping; never block startup on it.
            log.warn("Legacy generation output cleanup under {} failed", outputRoot, e);
        }
    }
}
