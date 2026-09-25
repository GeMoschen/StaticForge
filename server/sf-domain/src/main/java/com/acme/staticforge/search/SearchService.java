package com.acme.staticforge.search;

import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.asset.AssetType;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Project-scoped editorial search (M23.3.1, M23.2.2): validates a request, queries the project's index and reports how
 * current it is. The only entry point the API uses; the index of another project is never opened.
 */
@Service
public class SearchService {

    public static final int MAX_QUERY_CHARS = 200;
    public static final int MAX_PAGE_SIZE = 100;

    /** Deepest hit a page may reach: {@code (page + 1) * size}. */
    public static final int MAX_RESULT_WINDOW = 10_000;

    private static final String RELEVANCE = "relevance";

    private final SearchIndexService index;
    private final SearchIndexer indexer;

    public SearchService(SearchIndexService index, SearchIndexer indexer) {
        this.index = index;
        this.indexer = indexer;
    }

    /**
     * One page of hits and the index state they were answered from.
     *
     * @param status the index state when the query ran; its revisions tell how current the hits are
     */
    public record Result(SearchHits hits, int page, int size, SearchStatus status) {}

    public Result search(long projectId, String q, List<String> types, String folder, int page, int size, String sort) {
        return search(projectId, q, types, folder, page, size, sort, null);
    }

    /**
     * As {@link #search(long, String, List, String, int, int, String)}, restricted to one content
     * language (M24.3.3): the query then reads that language's prose field, so a German word matches
     * through German stemming and an English-only value does not answer a German search.
     */
    public Result search(
            long projectId, String q, List<String> types, String folder, int page, int size, String sort, String locale) {
        return search(projectId, q, types, folder, page, size, sort, locale, List.of());
    }

    /** As above, restricted to assets with one of {@code releaseStatuses} in some locale (M27.1.3). */
    public Result search(
            long projectId,
            String q,
            List<String> types,
            String folder,
            int page,
            int size,
            String sort,
            String locale,
            List<String> releaseStatuses) {
        String text = q == null ? "" : q.strip();
        if (text.isEmpty()) {
            throw SearchProblems.badRequest("Parameter 'q' is required.");
        }
        if (text.length() > MAX_QUERY_CHARS) {
            throw SearchProblems.badRequest("Parameter 'q' must be at most " + MAX_QUERY_CHARS + " characters.");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw SearchProblems.badRequest("Parameter 'size' must be between 1 and " + MAX_PAGE_SIZE + ".");
        }
        if (page < 0 || (long) (page + 1) * size > MAX_RESULT_WINDOW) {
            throw SearchProblems.badRequest("Parameter 'page' must be at least 0 and reach at most "
                    + MAX_RESULT_WINDOW + " hits.");
        }
        if (sort != null && !sort.isBlank() && !RELEVANCE.equalsIgnoreCase(sort.strip())) {
            throw SearchProblems.badRequest("Only sort=relevance is supported.");
        }
        SearchStatus status = indexer.status(projectId);
        if (status.state() == SearchStatus.State.UNAVAILABLE) {
            throw SearchProblems.unavailable();
        }
        SearchQuery query =
                new SearchQuery(text, parseTypes(types), folder, page, size, locale, parseStatuses(releaseStatuses));
        return new Result(index.search(projectId, query), page, size, status);
    }

    public SearchStatus status(long projectId) {
        return indexer.status(projectId);
    }

    /** Starts a full rebuild; {@code 409} while one is queued or running, {@code 503} when the index is unavailable. */
    public SearchStatus reindex(long projectId) {
        if (indexer.status(projectId).state() == SearchStatus.State.UNAVAILABLE) {
            throw SearchProblems.unavailable();
        }
        if (!indexer.requestRebuild(projectId)) {
            throw SearchProblems.reindexRunning();
        }
        return indexer.status(projectId);
    }

    private static Set<String> parseStatuses(List<String> statuses) {
        Set<String> parsed = new java.util.LinkedHashSet<>();
        if (statuses == null) {
            return parsed;
        }
        for (String raw : statuses) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            for (String part : raw.split(",")) {
                if (part.isBlank()) {
                    continue;
                }
                try {
                    parsed.add(ReleaseStatus.valueOf(part.strip().toUpperCase(Locale.ROOT)).name());
                } catch (IllegalArgumentException e) {
                    throw SearchProblems.badRequest("Unknown release status '" + part.strip() + "'.");
                }
            }
        }
        return parsed;
    }

    private static Set<AssetType> parseTypes(List<String> types) {
        Set<AssetType> parsed = EnumSet.noneOf(AssetType.class);
        if (types == null) {
            return parsed;
        }
        for (String raw : types) {
            if (raw == null || raw.isBlank()) {
                continue;
            }
            for (String part : raw.split(",")) {
                if (part.isBlank()) {
                    continue;
                }
                try {
                    parsed.add(AssetType.valueOf(part.strip().toUpperCase(Locale.ROOT)));
                } catch (IllegalArgumentException e) {
                    throw SearchProblems.badRequest("Unknown asset type '" + part.strip() + "'.");
                }
            }
        }
        return parsed;
    }
}
