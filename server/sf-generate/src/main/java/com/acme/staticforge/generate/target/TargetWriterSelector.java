package com.acme.staticforge.generate.target;

import com.acme.staticforge.generate.GenerationProperties;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.TargetLocations;
import java.nio.file.Path;
import org.springframework.stereotype.Service;

/**
 * Selects the correct {@link TargetWriter} for a {@link GenerationTarget} (spec §18.4) based on
 * its {@code TargetType}. Each writer is rooted at the target's own directory (see
 * {@link TargetLocations}), so runs of different projects or targets never share a
 * {@code current} pointer or a retention pool.
 */
@Service
public class TargetWriterSelector {

    private final GenerationProperties properties;

    public TargetWriterSelector(GenerationProperties properties) {
        this.properties = properties;
    }

    public TargetWriter forTarget(String projectKey, GenerationTarget target) {
        Path root = TargetLocations.resolve(Path.of(properties.getOutputRoot()), projectKey, target);
        return switch (target.getType()) {
            case FILESYSTEM -> new FilesystemTargetWriter(root, properties.getKeepBuilds());
            case ZIP -> new ZipTargetWriter(root, properties.getKeepBuilds());
            case S3 -> new S3TargetWriter(root);
        };
    }
}
