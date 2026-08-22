package com.acme.staticforge.asset.media;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Filesystem-backed {@link BlobStore} (the default). Bytes live at
 * {@code {root}/{sha[0:2]}/{sha[2:4]}/{sha}} so large sets split across shard directories. The
 * root is taken from {@code sf.media.root}.
 */
@Component
@ConditionalOnProperty(name = "sf.media.store", havingValue = "filesystem", matchIfMissing = true)
public class FilesystemBlobStore implements BlobStore {

    private final Path root;

    public FilesystemBlobStore(MediaProperties properties) {
        this.root = properties.getRoot() == null ? Path.of("build/media") : Path.of(properties.getRoot());
    }

    @Override
    public void put(String sha256, byte[] bytes) {
        if (exists(sha256)) {
            return;
        }
        Path target = resolveAbsolute(sha256);
        try {
            Files.createDirectories(target.getParent());
            Path tmp = target.getParent().resolve(sha256 + ".tmp");
            Files.write(tmp, bytes, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.other(500, "SF-MEDIA-0501", "Storage Failure", "Failed to write blob to disk."),
                    e.getMessage(), e);
        }
    }

    @Override
    public byte[] get(String sha256) {
        Path target = resolveAbsolute(sha256);
        try {
            return Files.readAllBytes(target);
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.other(500, "SF-MEDIA-0502", "Storage Failure", "Failed to read blob from disk."),
                    e.getMessage(), e);
        }
    }

    @Override
    public boolean exists(String sha256) {
        return Files.isRegularFile(resolveAbsolute(sha256));
    }

    @Override
    public void delete(String sha256) {
        try {
            Files.deleteIfExists(resolveAbsolute(sha256));
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.other(500, "SF-MEDIA-0503", "Storage Failure", "Failed to delete blob from disk."),
                    e.getMessage(), e);
        }
    }

    @Override
    public String storageKey(String sha256) {
        return sha256.substring(0, 2) + "/" + sha256.substring(2, 4) + "/" + sha256;
    }

    private Path resolveAbsolute(String sha256) {
        return root.resolve(sha256.substring(0, 2)).resolve(sha256.substring(2, 4)).resolve(sha256).toAbsolutePath();
    }
}
