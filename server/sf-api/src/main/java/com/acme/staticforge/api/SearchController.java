package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.SearchResultView;
import com.acme.staticforge.api.dto.SearchStatusView;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.search.SearchHit;
import com.acme.staticforge.search.SearchHits;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.search.SearchStatus;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Editorial full-text search over a project's current assets (M23.3.1) and its index operations (M23.2.2). Only the
 * path's project is ever searched.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/search")
public class SearchController {

    private final ProjectService projectService;
    private final SearchService searchService;

    public SearchController(ProjectService projectService, SearchService searchService) {
        this.projectService = projectService;
        this.searchService = searchService;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public SearchResultView search(
            @PathVariable String projectKey,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) List<String> type,
            @RequestParam(required = false) String folder,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String locale) {
        SearchService.Result result =
                searchService.search(projectId(projectKey), q, type, folder, page, size, sort, locale);
        SearchHits hits = result.hits();
        Map<String, Long> types = new LinkedHashMap<>();
        hits.typeCounts().entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> types.put(entry.getKey().name(), entry.getValue()));
        int totalPages = (int) ((hits.totalHits() + result.size() - 1) / result.size());
        return new SearchResultView(
                hits.hits().stream().map(SearchController::toHit).toList(),
                new SearchResultView.SearchPageMeta(result.size(), result.page(), hits.totalHits(), totalPages, false),
                new SearchResultView.SearchFacets(types),
                result.status().indexedRevision(),
                result.status().latestRevision());
    }

    @GetMapping("/status")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public SearchStatusView status(@PathVariable String projectKey) {
        return toStatus(searchService.status(projectId(projectKey)));
    }

    @PostMapping("/reindex")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<SearchStatusView> reindex(@PathVariable String projectKey) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(toStatus(searchService.reindex(projectId(projectKey))));
    }

    private long projectId(String projectKey) {
        return projectService.requireByKey(projectKey).getId();
    }

    private static SearchResultView.SearchHitView toHit(SearchHit hit) {
        return new SearchResultView.SearchHitView(
                hit.uuid(),
                hit.type().name(),
                hit.uid(),
                hit.displayName(),
                hit.folderPath(),
                hit.templateUuid(),
                hit.score(),
                hit.matchedIn().name(),
                hit.snippet().text(),
                hit.snippet().highlights().stream()
                        .map(range -> new SearchResultView.SearchHighlight(range.start(), range.end()))
                        .toList());
    }

    private static SearchStatusView toStatus(SearchStatus status) {
        return new SearchStatusView(
                status.indexedRevision(), status.latestRevision(), status.lag(), status.state().name(), status.lastRebuildAt());
    }
}
