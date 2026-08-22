package com.acme.staticforge.asset.media;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * S3-backed {@link BlobStore} placeholder (spec §11.2 "optional"). Selected with
 * {@code sf.media.store=s3}; not implemented in v1. Every operation fails fast with a clear
 * problem so a misconfigured deployment surfaces immediately rather than writing to the wrong
 * backend. Implement against the configured bucket/prefix when object storage is introduced.
 */
@Component
@ConditionalOnProperty(name = "sf.media.store", havingValue = "s3")
public class S3BlobStore implements BlobStore {

    public S3BlobStore() {}

    @Override
    public void put(String sha256, byte[] bytes) {
        throw notImplemented();
    }

    @Override
    public byte[] get(String sha256) {
        throw notImplemented();
    }

    @Override
    public boolean exists(String sha256) {
        throw notImplemented();
    }

    @Override
    public void delete(String sha256) {
        throw notImplemented();
    }

    @Override
    public String storageKey(String sha256) {
        throw notImplemented();
    }

    private static SfException notImplemented() {
        return new SfException(ProblemFactory.other(
                501, "SF-MEDIA-0501", "Not Implemented", "S3 media storage is not implemented in v1."));
    }
}
