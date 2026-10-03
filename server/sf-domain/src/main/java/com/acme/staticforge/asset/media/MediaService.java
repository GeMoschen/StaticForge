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

    /**
     * Localizes ({@code true}) or un-localizes a media asset in one revision (M27.3.1, epic decision 19). Localizing
     * makes the file the default locale's; un-localizing keeps the file the default locale renders and discards the
     * others — a {@code 409 SF-MEDIA-0505} listing them unless {@code confirmDiscard}. The release pointers are
     * rewritten to match ({@code ""} ↔ one per locale), each keeping the status it had. {@code 422 SF-MEDIA-0508} in
     * a project without locales; the value it already has writes no revision.
     */
    AssetVersionView setLocalized(
            UUID uuid, boolean localized, boolean confirmDiscard, long expectedRevision, RevisionContext ctx);

    /**
     * Stores or replaces {@code locale}'s own file of localized media in one revision, through the full upload
     * pipeline (M27.3.1); for the locale that owns the top-level file this is {@link #replace}. A processed file stays
     * processed like {@link #replace}. {@code 422 SF-MEDIA-0506} for media that isn't localized, {@code 0507} for a
     * locale the project doesn't declare.
     */
    MediaWriteResult putLocaleFile(
            UUID uuid, String locale, String fileName, String suppliedMimeType, byte[] bytes, RevisionContext ctx);

    /**
     * Removes {@code locale}'s own file of localized media in one revision, so the locale falls back again
     * (M27.3.1). The default file can't be removed ({@code 422 SF-MEDIA-0509}); a locale without its own file writes
     * no revision. Refusals as {@link #putLocaleFile}.
     */
    AssetVersionView removeLocaleFile(UUID uuid, String locale, RevisionContext ctx);

    /**
     * Updates alt text, caption, copyright and focal point (optimistic-concurrency-checked). In a
     * project with locales, {@code altText} and {@code caption} are language-dependent (M24.2.2):
     * the write targets {@code locale} (the project default when {@code null}) and leaves the other
     * languages untouched. {@code copyright} is single-valued.
     */
    AssetVersionView updateMetadata(UUID uuid, String altText, String caption, String copyright,
            FocalPoint focalPoint, String locale, long expectedRevision, RevisionContext ctx);

    /**
     * Switches OCTL processing of a text media file on or off (M18.1.1) in one revision. Non-text
     * MIME types are a {@code 400}; switching on compiles the current source, and errors are a
     * {@code 422} with nothing changed. Setting the value it already has writes no revision.
     */
    MediaWriteResult setProcessCms(UUID uuid, boolean processCms, long expectedRevision, RevisionContext ctx);

    /**
     * As {@link #setProcessCms(UUID, boolean, long, RevisionContext)}, for the file {@code locale} renders of localized
     * media (M27.3.1): its own file, or the one it falls back to. {@code null}, and media that isn't localized, mean
     * the default file.
     */
    MediaWriteResult setProcessCms(
            UUID uuid, boolean processCms, String locale, long expectedRevision, RevisionContext ctx);

    /** The text content of a text media file, current or at {@code revision}; non-text types are a {@code 400}. */
    MediaText readText(long projectId, UUID uuid, Long revision);

    /** As {@link #readText(long, UUID, Long)}, the file {@code locale} renders of localized media (M27.3.1). */
    MediaText readText(long projectId, UUID uuid, Long revision, String locale);

    /**
     * Replaces a text media file's content with {@code text} (UTF-8) in one revision, keeping its
     * MIME type, file name, metadata and {@code processCms}. Upload rules apply (size cap, SVG
     * sanitizing); a processed file's new source is compiled first and errors are a {@code 422}.
     * Content identical to the stored blob writes no revision.
     */
    MediaWriteResult writeText(UUID uuid, String text, long expectedRevision, RevisionContext ctx);

    /**
     * As {@link #writeText(UUID, String, long, RevisionContext)}, into {@code locale}'s own file of localized media
     * (M27.3.1): a locale that falls back gets its own file, a copy of the one it rendered with the new content.
     * {@code null}, and media that isn't localized, mean the default file; an undeclared locale is a
     * {@code 422 SF-MEDIA-0507}.
     */
    MediaWriteResult writeText(UUID uuid, String text, String locale, long expectedRevision, RevisionContext ctx);

    /** Compiles draft {@code text} as the source of this text media file, without saving anything. */
    List<Diagnostic> validateText(long projectId, UUID uuid, String text);

    /** The current media version. */
    AssetVersionView require(long projectId, UUID uuid);

    /** Current media versions filtered by MIME family, folder and display-name substring. */
    /** {@code recursive} controls whether {@code folder} matches that folder's own contents only, or also its descendants. */
    Page<AssetVersionView> list(long projectId, String mimeType, String folder, boolean recursive, String q, Pageable pageable);

    /** How many places reference each of the given media (the listing's "used by" count), in one query. */
    java.util.Map<UUID, Integer> usageCounts(long projectId, java.util.Collection<UUID> uuids);

    /** The bytes of a media asset (or a named variant), or throws when the blob is absent. */
    MediaBinary binary(long projectId, UUID uuid, String variantName);

    /** Like {@link #binary(long, UUID, String)}, for the version valid at {@code revision} (current when {@code null}). */
    MediaBinary binary(long projectId, UUID uuid, String variantName, Long revision);

    /** As {@link #binary(long, UUID, String, Long)}, the file {@code locale} renders of localized media (M27.3.1). */
    MediaBinary binary(long projectId, UUID uuid, String variantName, Long revision, String locale);

    /** The media version valid at {@code revision} (current when {@code null}), or throws 404. */
    AssetVersionView requireAt(long projectId, UUID uuid, Long revision);

    /** A 320px-wide preview thumbnail of an image media asset. */
    MediaBinary thumbnail(long projectId, UUID uuid);

    /** As {@link #thumbnail(long, UUID)}, of the file {@code locale} renders of localized media (M27.3.1). */
    MediaBinary thumbnail(long projectId, UUID uuid, String locale);
}
