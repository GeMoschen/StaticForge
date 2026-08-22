package com.acme.staticforge.generate.stage;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.generate.pipeline.MediaPaths;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Copies referenced media into the build (spec §18.2 ASSETS). Reads each blob from the
 * content-addressed {@link BlobStore} using the {@code blobSha256} recorded in the media
 * payload (revision-pinned, so the snapshot — not the live asset — dictates which bytes are
 * copied), emitting one {@link OutputFile} per primary binary and one per named variant. Paths
 * come from {@link MediaPaths}, keeping the ASSETS stage and the renderer's {@code $CMS_REF}
 * resolver in lock-step.
 */
@Service
public class AssetCopyStage {

    private final BlobStore blobStore;

    public AssetCopyStage(BlobStore blobStore) {
        this.blobStore = blobStore;
    }

    /** Builds the ordered list of media files to write for the referenced media set. */
    public AssetCopyResult copy(Snapshot snapshot, Set<UUID> referencedMediaUuids) {
        List<OutputFile> files = new ArrayList<>();
        long copied = 0;
        long skipped = 0;

        for (UUID uuid : referencedMediaUuids == null ? Set.<UUID>of() : referencedMediaUuids) {
            SnapshotAsset media = snapshot.assetByUuid(uuid);
            if (media == null || media.type() != AssetType.MEDIA) {
                continue;
            }
            JsonNode payload = media.payload();
            String uid = media.uid() == null ? "" : media.uid();

            String primarySha = text(payload, "blobSha256");
            if (primarySha != null) {
                String mime = text(payload, "mimeType");
                byte[] bytes = readOrNull(primarySha);
                if (bytes != null) {
                    files.add(new OutputFile(MediaPaths.mediaPath(uid, MediaPaths.extensionFor(mime)), bytes));
                    copied++;
                } else {
                    skipped++;
                }
            }

            JsonNode variants = payload == null ? null : payload.get("variants");
            if (variants != null && variants.isArray()) {
                for (JsonNode variant : variants) {
                    String name = text(variant, "name");
                    String sha = text(variant, "blobSha256");
                    if (name == null || sha == null) {
                        continue;
                    }
                    byte[] bytes = readOrNull(sha);
                    if (bytes != null) {
                        files.add(new OutputFile(
                                MediaPaths.variantPath(uid, name, extensionForFormat(text(variant, "format"))), bytes));
                        copied++;
                    } else {
                        skipped++;
                    }
                }
            }
        }

        return new AssetCopyResult(List.copyOf(files), copied, skipped);
    }

    private byte[] readOrNull(String sha) {
        try {
            return blobStore.get(sha);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Variant {@code format} ("jpeg") → file extension ("jpg"); mirrors the renderer's URL resolver. */
    private static String extensionForFormat(String format) {
        if (format == null || format.isBlank()) {
            return "bin";
        }
        String value = format.toLowerCase(Locale.ROOT);
        return "jpeg".equals(value) ? "jpg" : value;
    }

    private static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode value = node.get(field);
        return value != null && value.isTextual() && !value.asText().isBlank() ? value.asText() : null;
    }
}
