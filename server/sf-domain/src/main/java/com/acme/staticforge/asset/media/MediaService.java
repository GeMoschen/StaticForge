package com.acme.staticforge.asset.media;

import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.io.InputStream;
import java.util.List;
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

    /**
     * Swaps the binary of an existing media asset for {@code bytes}, keeping the same UUID. A
     * processed file stays processed when the new file is text too (its source is compiled, errors
     * are a {@code 422}); otherwise {@code processCms} is switched off and the result says so.
     */
    MediaWriteResult replace(UUID uuid, String fileName, String suppliedMimeType, byte[] bytes, RevisionContext ctx);

    /** Updates alt text, caption, copyright and focal point (optimistic-concurrency-checked). */
    AssetVersionView updateMetadata(UUID uuid, String altText, String caption, String copyright,
            FocalPoint focalPoint, long expectedRevision, RevisionContext ctx);

    /**
     * Switches OCTL processing of a text media file on or off (M18.1.1) in one revision. Non-text
     * MIME types are a {@code 400}; switching on compiles the current source, and errors are a
     * {@code 422} with nothing changed. Setting the value it already has writes no revision.
     */
    MediaWriteResult setProcessCms(UUID uuid, boolean processCms, long expectedRevision, RevisionContext ctx);

    /** The text content of a text media file, current or at {@code revision}; non-text types are a {@code 400}. */
    MediaText readText(long projectId, UUID uuid, Long revision);

    /**
     * Replaces a text media file's content with {@code text} (UTF-8) in one revision, keeping its
     * MIME type, file name, metadata and {@code processCms}. Upload rules apply (size cap, SVG
     * sanitizing); a processed file's new source is compiled first and errors are a {@code 422}.
     * Content identical to the stored blob writes no revision.
     */
    MediaWriteResult writeText(UUID uuid, String text, long expectedRevision, RevisionContext ctx);

    /** Compiles draft {@code text} as the source of this text media file, without saving anything. */
    List<Diagnostic> validateText(long projectId, UUID uuid, String text);

    /** The current media version. */
    AssetVersionView require(long projectId, UUID uuid);

    /** Current media versions filtered by MIME family, folder and display-name substring. */
    /** {@code recursive} controls whether {@code folder} matches that folder's own contents only, or also its descendants. */
    Page<AssetVersionView> list(long projectId, String mimeType, String folder, boolean recursive, String q, Pageable pageable);

    /** The bytes of a media asset (or a named variant), or throws when the blob is absent. */
    MediaBinary binary(long projectId, UUID uuid, String variantName);

    /** Like {@link #binary(long, UUID, String)}, for the version valid at {@code revision} (current when {@code null}). */
    MediaBinary binary(long projectId, UUID uuid, String variantName, Long revision);

    /** The media version valid at {@code revision} (current when {@code null}), or throws 404. */
    AssetVersionView requireAt(long projectId, UUID uuid, Long revision);

    /** A 320px-wide preview thumbnail of an image media asset. */
    MediaBinary thumbnail(long projectId, UUID uuid);
}
