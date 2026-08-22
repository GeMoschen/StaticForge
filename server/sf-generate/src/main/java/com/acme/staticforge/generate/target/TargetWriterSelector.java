package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.GenerationTarget;
import java.nio.file.Path;
import org.springframework.stereotype.Service;

/**
 * Selects the correct {@link TargetWriter} for a {@link GenerationTarget} (spec §18.4) based on
 * its {@code TargetType}. Writers are constructed per-target with the shared
 * {@link GenerationProperties} (output root and retention) so that concurrent runs of different
 * projects write into distinct, runId-qualified directories.
 */
@Service
public class TargetWriterSelector {

    private final GenerationProperties properties;

    public TargetWriterSelector(GenerationProperties properties) {
        this.properties = properties;
    }

    public TargetWriter forTarget(GenerationTarget target) {
        Path outputRoot = Path.of(properties.getOutputRoot());
        return switch (target.getType()) {
            case FILESYSTEM -> new FilesystemTargetWriter(outputRoot, properties.getKeepBuilds());
            case ZIP -> new ZipTargetWriter(outputRoot, properties.getKeepBuilds());
            case S3 -> new S3TargetWriter(outputRoot, target.getName());
        };
    }
}
