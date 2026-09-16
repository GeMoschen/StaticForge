package com.acme.staticforge.generate.plan;

import com.acme.staticforge.pagination.PaginationItem;
import com.acme.staticforge.pagination.PaginationSource;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;
import java.util.UUID;

/**
 * A paginated page in one channel, resolved once by the planner (M21.2.1) and shared by all of its plan entries: the
 * renderer slices exactly the items the page count came from, and links pages by the paths the plan writes.
 *
 * @param sourceUuid the navigation folder or dataset paginated
 * @param items every eligible item, in page order
 * @param paths the output path of each page, page 1 first ({@code paths.size()} is the page count)
 * @param warnings the source's warnings (skipped dangling references), reported once, with page 1
 */
public record PaginatedPage(
        UUID sourceUuid, int pageSize, List<PaginationItem> items, List<String> paths, List<Diagnostic> warnings) {

    public PaginatedPage {
        items = List.copyOf(items);
        paths = List.copyOf(paths);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
        if (paths.size() != PaginationSource.totalPages(items.size(), pageSize)) {
            throw new IllegalArgumentException("A paginated page needs one path per page");
        }
    }

    public int totalPages() {
        return paths.size();
    }

    /** The output path of 1-based page {@code number}. */
    public String path(int number) {
        return paths.get(number - 1);
    }
}
