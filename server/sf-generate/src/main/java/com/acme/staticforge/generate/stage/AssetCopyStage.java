package com.acme.staticforge.generate.stage;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.media.BlobStore;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.asset.media.MediaPaths;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.fasterxml.jackson.databind.JsonNode;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
 *
 * <p>A processed text media file ({@code processCms}, M18.3.1) is rendered through
 * {@link MediaRenderStage} instead of copied, to the same path. The media it depends on (an image in
 * a CSS {@code url()}, a font, another processed stylesheet) joins the copy set, transitively: the
 * set is walked to a fixed point with a visited set, so two stylesheets referencing each other
 * terminate. The walk is sequential; only rendering discovers the next dependencies.
 */
@Service
public class AssetCopyStage {

    private final BlobStore blobStore;

    public AssetCopyStage(BlobStore blobStore) {
        this.blobStore = blobStore;
    }

    /**
     * Builds the ordered list of media files to write for the referenced media set, rendering
     * processed media with {@code mediaRenderer} and following their media dependencies.
     */
    public AssetCopyResult copy(Snapshot snapshot, Set<UUID> referencedMediaUuids, MediaRenderStage.Build mediaRenderer) {
        List<OutputFile> files = new ArrayList<>();
        List<Diagnostic> warnings = new ArrayList<>();
        List<Diagnostic> fileErrors = new ArrayList<>();
        Map<String, UUID> owners = new HashMap<>();
        Map<UUID, Set<UUID>> dependencies = new HashMap<>();
        long copied = 0;
        long skipped = 0;

        Deque<UUID> pending = new ArrayDeque<>(referencedMediaUuids == null ? Set.<UUID>of() : referencedMediaUuids);
        Set<UUID> visited = new HashSet<>();
        while (!pending.isEmpty()) {
            UUID uuid = pending.poll();
            if (!visited.add(uuid)) {
                continue;
            }
            SnapshotAsset media = snapshot.assetByUuid(uuid);
            if (media == null || media.deleted() || media.type() != AssetType.MEDIA) {
                continue;
            }
            JsonNode payload = media.payload();
            String uid = media.uid() == null ? "" : media.uid();

            if (TextMediaTypes.isProcessed(payload)) {
                MediaRenderStage.Result rendered = mediaRenderer.render(media);
                if (rendered.error() != null) {
                    fileErrors.add(rendered.error());
                    continue;
                }
                files.add(rendered.file().toOutputFile());
                owners.put(rendered.file().outputPath(), uuid);
                dependencies.put(uuid, mediaOnly(snapshot, rendered.file().dependencies()));
                copied++;
                warnings.addAll(rendered.file().diagnostics());
                // Deterministic order: a rendered file's dependency set is unordered.
                rendered.file().dependencies().stream()
                        .filter(dependency -> !visited.contains(dependency))
                        .sorted(Comparator.comparing(UUID::toString))
                        .forEach(pending::add);
                continue;
            }

            String primarySha = text(payload, "blobSha256");
            if (primarySha != null) {
                String mime = text(payload, "mimeType");
                byte[] bytes = readOrNull(primarySha);
                if (bytes != null) {
                    OutputFile file = new OutputFile(MediaPaths.mediaPath(uid, MediaPaths.extensionFor(mime)), bytes);
                    files.add(file);
                    owners.put(file.path(), uuid);
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
                        OutputFile file = new OutputFile(
                                MediaPaths.variantPath(uid, name, extensionForFormat(text(variant, "format"))), bytes);
                        files.add(file);
                        owners.put(file.path(), uuid);
                        copied++;
                    } else {
                        skipped++;
                    }
                }
            }
        }

        return new AssetCopyResult(files, copied, skipped, warnings, fileErrors, owners, dependencies);
    }

    /** The media among a rendered file's dependencies. */
    static Set<UUID> mediaOnly(Snapshot snapshot, Set<UUID> dependencies) {
        Set<UUID> media = new HashSet<>();
        for (UUID dependency : dependencies) {
            SnapshotAsset asset = snapshot.assetByUuid(dependency);
            if (asset != null && asset.type() == AssetType.MEDIA) {
                media.add(dependency);
            }
        }
        return media;
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
