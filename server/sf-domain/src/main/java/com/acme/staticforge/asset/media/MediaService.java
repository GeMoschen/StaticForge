package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.revision.RevisionContext;
import java.io.InputStream;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * Media asset operations (spec §11). Owns the upload flow — SHA-256, Tika MIME sniffing,
 * allow-list + size-cap enforcement, EXIF strip, variant generation — and the
 * {@code replace} / metadata / binary reads that the REST layer exposes. Every mutating method
 * persists through {@link com.acme.staticforge.asset.AssetService} so media remains a
 * revisioned {@code MEDIA} asset.
 */
public interface MediaService {

    /** Uploads {@code bytes} as a new MEDIA asset; {@code altText}/{@code caption} default to null. */
    AssetVersionView upload(
            long projectId, UUID folderUuid, String fileName, String suppliedMimeType, byte[] bytes, RevisionContext ctx);

    /** Uploads {@code bytes} with initial alt text and caption. */
    AssetVersionView upload(long projectId, UUID folderUuid, String fileName, String suppliedMimeType,
            String altText, String caption, byte[] bytes, RevisionContext ctx);

    /** Multipart-friendly upload: reads the stream fully into memory (bounded by the size cap). */
    AssetVersionView upload(long projectId, UUID folderUuid, String fileName, String suppliedMimeType,
            String altText, String caption, InputStream in, RevisionContext ctx);

    /** Swaps the binary of an existing media asset for {@code bytes}, keeping the same UUID. */
    AssetVersionView replace(UUID uuid, String fileName, String suppliedMimeType, byte[] bytes, RevisionContext ctx);

    /** Updates alt text, caption, copyright and focal point (optimistic-concurrency-checked). */
    AssetVersionView updateMetadata(UUID uuid, String altText, String caption, String copyright,
            FocalPoint focalPoint, long expectedRevision, RevisionContext ctx);

    /** The current media version. */
    AssetVersionView require(long projectId, UUID uuid);

    /** Current media versions filtered by MIME family, folder and display-name substring. */
    /** {@code recursive} controls whether {@code folder} matches that folder's own contents only, or also its descendants. */
    Page<AssetVersionView> list(long projectId, String mimeType, String folder, boolean recursive, String q, Pageable pageable);

    /** The bytes of a media asset (or a named variant), or throws when the blob is absent. */
    MediaBinary binary(long projectId, UUID uuid, String variantName);

    /** A 320px-wide preview thumbnail of an image media asset. */
    MediaBinary thumbnail(long projectId, UUID uuid);
}
