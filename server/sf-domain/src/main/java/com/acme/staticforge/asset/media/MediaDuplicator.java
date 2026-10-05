package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.transfer.AssetDuplicator;
import com.acme.staticforge.asset.transfer.DuplicateTarget;
import com.acme.staticforge.revision.RevisionContext;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Copies a media file: the payload (every locale's file, its variants, alt text and caption in every language,
 * copyright, focal point, process flag) with a new uuid, as an unreleased draft. Blobs are content-addressed, so the
 * copy refers to the same hashes (and the {@code media_variant} rows keyed by them); every blob is re-registered
 * through the {@link BlobWriter} like an upload of identical bytes, which also guards it against a concurrent blob
 * sweep and re-stores bytes that went missing.
 */
@Component
class MediaDuplicator implements AssetDuplicator {

    private final AssetService assets;
    private final BlobStore blobStore;
    private final BlobWriter blobWriter;

    MediaDuplicator(AssetService assets, BlobStore blobStore, BlobWriter blobWriter) {
        this.assets = assets;
        this.blobStore = blobStore;
        this.blobWriter = blobWriter;
    }

    @Override
    public AssetType type() {
        return AssetType.MEDIA;
    }

    @Override
    public AssetVersionView duplicate(AssetVersionView source, DuplicateTarget target, RevisionContext ctx) {
        JsonNode payload = source.payload().deepCopy();
        blobMimeTypes(payload).forEach((sha, mimeType) -> blobWriter.store(sha, blobStore.get(sha), mimeType));
        return assets.create(
                new CreateAssetCommand(
                        ctx.projectId(),
                        AssetType.MEDIA,
                        target.copyName(source.displayName()),
                        target.parentUuid(),
                        payload,
                        null),
                ctx);
    }

    /** Every blob of the payload (each file and its variants) with the MIME type it is stored under. */
    private static Map<String, String> blobMimeTypes(JsonNode payload) {
        Map<String, String> blobs = new LinkedHashMap<>();
        List<JsonNode> files = new ArrayList<>();
        files.add(payload);
        MediaFiles.localeFileKeys(payload).forEach(locale -> files.add(payload.path(MediaFiles.LOCALE_FILES).get(locale)));
        for (JsonNode file : files) {
            if (file == null || !file.isObject()) {
                continue;
            }
            put(blobs, file.get("blobSha256"), file.path("mimeType").asText("application/octet-stream"));
            for (JsonNode variant : file.path("variants")) {
                put(blobs, variant.get("blobSha256"), "image/" + variant.path("format").asText("png"));
            }
        }
        return blobs;
    }

    private static void put(Map<String, String> blobs, JsonNode sha, String mimeType) {
        if (sha != null && sha.isTextual() && !sha.asText().isBlank()) {
            blobs.putIfAbsent(sha.asText(), mimeType);
        }
    }
}
