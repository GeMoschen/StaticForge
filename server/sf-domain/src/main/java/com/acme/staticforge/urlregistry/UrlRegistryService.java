package com.acme.staticforge.urlregistry;

import com.acme.staticforge.revision.RevisionContext;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * The URL registry (M8.2, every output since M32): each page output, media file and index-less folder has one URL per
 * channel, {@link UrlArea} and language, assigned once and then authoritative — a build writes the output there and
 * every link to it uses it — until a reset deletes it or an override replaces it. Page references and folders with an
 * index page have no rows of their own: they resolve to their page first.
 *
 * <p>A build reads its area once ({@link #view}), claims first-time URLs in memory and {@link #register}s them when it
 * publishes. A preview resolves link by link ({@link #resolve}).
 *
 * <p>{@code RevisionContext} is accepted by the write methods for the project scope and the caller's identity; the
 * registry allocates no revisions (see {@code UrlRegistryServiceImpl}).
 */
public interface UrlRegistryService {

    /**
     * The URL of {@code target} in one channel, area and language: the stored one, else {@code computed}'s, which is
     * stored (assign once). {@code null} when there is none and {@code computed} has none either. A computed URL that
     * another target holds is returned but not stored (the preview falls back; the clash is logged).
     *
     * @param localeKey the row's language key: {@link #localeKey} of the language for pages and folders; for media the
     *     language the file is written for, {@code ""} for media that isn't localized
     */
    String resolve(
            UrlTarget target, String channelKey, UrlArea area, String localeKey, Supplier<String> computed, RevisionContext ctx);

    /**
     * The URL of page {@code pageNumber} of {@code pageUuid} computed from the live drafts (or the stored one), as
     * {@link #resolve}; {@code null} when the page doesn't exist.
     */
    String resolvePage(UUID pageUuid, int pageNumber, String channelKey, UrlArea area, String locale, RevisionContext ctx);

    /**
     * The URL of the page a page reference (or a navigation folder) resolves to in this channel — its page's URL.
     *
     * @throws com.acme.staticforge.common.SfException (not-found) when it doesn't resolve to a page
     */
    String resolvePageReference(UUID pageReferenceUuid, String channelKey, UrlArea area, String locale, RevisionContext ctx);

    /**
     * Upserts a row with a manually chosen URL, marking it {@code overridden}. {@code localeKey} is the row's language
     * key ({@code ""} for a row without a language). Records a change an incremental build follows (M32.5).
     *
     * @throws com.acme.staticforge.common.SfException {@code 409 SF-DOM-0200} when another target holds the URL,
     *     {@code 422 SF-DOM-0201} when it is not a valid URL for the target
     */
    UrlRegistryEntry override(
            UrlTarget target, String channelKey, UrlArea area, String localeKey, String url, RevisionContext ctx);

    /**
     * Deletes every entry matching {@code scope} (see {@link ResetScope}). Does not recompute — the next build or
     * preview assigns the affected targets their computed URL again.
     */
    void reset(long projectId, ResetScope scope, RevisionContext ctx);

    /** Every row of one area of a project, read once: what a build or a draft check resolves URLs through. */
    UrlRegistryView view(long projectId, UrlArea area);

    /**
     * Stores the first-time URLs a build claimed ({@link UrlRegistryView#claims()}), each unless its tuple or its URL
     * was taken meanwhile.
     *
     * @return the claims that could not be stored because another row took their URL or tuple first
     */
    List<UrlRegistryView.Claim> register(long projectId, UrlArea area, Collection<UrlRegistryView.Claim> claims);

    /** Deletes the computed (non-overridden) rows {@code keys} names in one area — targets that left the site. */
    int deleteComputed(long projectId, UrlArea area, Collection<UrlRegistryView.Key> keys);

    /** Deletes the computed rows of {@code targetUuid} in {@code area} (both areas for {@code null}). */
    void deleteComputed(long projectId, UUID targetUuid, UrlArea area);

    /** The URL changes (overrides, resets, imports) of {@code area} after {@code since} (M32.5). */
    List<UrlRegistryChange> changesSince(long projectId, UrlArea area, Instant since);

    /** Filtered listing for the settings UI and the asset editors ({@code M8.2.4}, M32.7). */
    Page<UrlRegistryEntry> search(long projectId, Filter filter, Pageable pageable);

    /**
     * The optional filters of {@link #search}.
     *
     * @param locale a language tag; {@code ""} for rows without a language
     * @param q case-insensitive text in the URL or in the target's display name or uid
     */
    record Filter(
            String channelKey, UrlArea area, UrlTargetType targetType, String locale, UUID targetUuid, String q) {

        public static final Filter NONE = new Filter(null, null, null, null, null, null);
    }

    /**
     * Looks up a single entry, scoped to {@code projectId} so a project-scoped REST caller can never reach another
     * project's row by guessing an id.
     *
     * @throws com.acme.staticforge.common.SfException (not-found) when no such entry exists in this project
     */
    UrlRegistryEntry require(long projectId, long id);

    /**
     * The key a row stores for {@code locale}: the canonical tag in a localized project (the default language for
     * {@code null}), and {@code ""} in a project without locales.
     */
    String localeKey(long projectId, String locale);

    /**
     * What a row's target is, for display (M32.7).
     *
     * @param type the asset's type name ({@code PAGE}, {@code MEDIA}, {@code FOLDER})
     * @param folderPath the stored path of the folder the asset lives in (a folder: its own)
     * @param deleted whether the asset's draft is deleted (a row kept for its override)
     */
    record TargetInfo(UUID uuid, String type, String uid, String displayName, String folderPath, boolean deleted) {}

    /** The display facts of {@code uuids}' assets; unknown uuids are left out. */
    java.util.Map<UUID, TargetInfo> describe(long projectId, Collection<UUID> uuids);

    /** A folder's index page in one channel: the page whose URL the folder uses (M32.7). */
    record IndexPage(String channelKey, UUID pageUuid) {}

    /** The index page of a pages folder in each of the project's channels that has one. */
    List<IndexPage> indexPages(long projectId, UUID folderUuid);

    /** Every row of one area of a project, oldest first (export, M32.6). */
    List<UrlRegistryEntry> all(long projectId, UrlArea area);

    /** How an import treats a row whose tuple the target project already has (M32.6). */
    enum ImportMode {
        /** The archive's row replaces the target's computed row; the target's overrides are kept (reported). */
        ARCHIVE_WINS,
        /** The target's rows stay; the archive only fills gaps. */
        TARGET_WINS,
        /** The archive's row replaces the target's, overrides included. */
        REPLACE_ALL
    }

    /** A row read from an archive (M32.6), its target already remapped to the target project's uuid. */
    record ImportedRow(
            UrlTarget target, String channelKey, UrlArea area, String localeKey, String url, boolean overridden) {}

    /** What an import did or would do with one archive row. */
    enum ImportOutcome {
        INSERTED,
        REPLACED,
        UNCHANGED,
        KEPT_TARGET,
        KEPT_TARGET_OVERRIDE,
        URL_TAKEN
    }

    /** One archive row's outcome; {@code holder} names the target holding the URL for {@link ImportOutcome#URL_TAKEN}. */
    record ImportResult(ImportedRow row, ImportOutcome outcome, UrlTarget holder) {}

    /**
     * Imports archive rows (M32.6) by {@code mode}; {@code dryRun} only reports what would happen. Records a change for
     * every target whose URL changed.
     */
    List<ImportResult> importRows(long projectId, Collection<ImportedRow> rows, ImportMode mode, boolean dryRun);
}
