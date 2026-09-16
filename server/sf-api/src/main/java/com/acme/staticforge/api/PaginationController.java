package com.acme.staticforge.api;

import com.acme.staticforge.asset.content.PaginationSourceLookup;
import com.acme.staticforge.asset.dataset.RecordDatasets;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.pagination.PaginationValue;
import com.acme.staticforge.preview.PageRenderService;
import com.acme.staticforge.project.ProjectService;
import java.util.Locale;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Pagination sources (M21.4.1). {@code GET /pagination/count?kind=NAV|DATASET&source=uuid} counts the items a
 * navigation folder or dataset contributes to a paginated page right now, for the page editor's
 * "N items → M pages" hint. {@code 404} when the source isn't a live folder of the Navigation store or a live dataset.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/pagination")
public class PaginationController {

    private final ProjectService projectService;
    private final PageRenderService pageRenderService;
    private final RecordDatasets recordDatasets;

    public PaginationController(
            ProjectService projectService, PageRenderService pageRenderService, RecordDatasets recordDatasets) {
        this.projectService = projectService;
        this.pageRenderService = pageRenderService;
        this.recordDatasets = recordDatasets;
    }

    /** The count; {@code skipped} counts navigation references that resolve to no page. */
    public record PaginationCountView(int itemCount, int skipped) {}

    @GetMapping("/count")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public PaginationCountView count(
            @PathVariable String projectKey, @RequestParam String kind, @RequestParam UUID source) {
        long projectId = projectService.requireByKey(projectKey).getId();
        PaginationValue.Kind sourceKind;
        try {
            sourceKind = PaginationValue.Kind.valueOf(kind.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.unprocessableEntity("kind must be NAV or DATASET."));
        }
        PaginationSourceLookup sources = recordDatasets.paginationSources(projectId);
        boolean exists = sourceKind == PaginationValue.Kind.NAV
                ? sources.isNavigationFolder(source)
                : sources.datasetSchema(source).isPresent();
        if (!exists) {
            throw new SfException(ProblemFactory.notFound(sourceKind == PaginationValue.Kind.NAV
                    ? "No folder of the Navigation store with this uuid."
                    : "No dataset with this uuid."));
        }
        PageRenderService.PaginationCount count = pageRenderService.countPaginationSource(projectId, sourceKind, source);
        return new PaginationCountView(count.itemCount(), count.skipped());
    }
}
