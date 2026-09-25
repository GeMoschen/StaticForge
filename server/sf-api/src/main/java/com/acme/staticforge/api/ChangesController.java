package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChangeDiffView;
import com.acme.staticforge.api.dto.ChangeRowView;
import com.acme.staticforge.api.dto.ChangesPageView;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ChangesService;
import com.acme.staticforge.release.ReleaseStatus;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The project's unreleased changes (M27.1.3): every (asset, locale) whose status isn't {@code PUBLISHED}, their
 * counts, and the released-to-draft diff of one of them. Read-only, {@code VIEWER}.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/changes")
public class ChangesController {

    static final int MAX_SIZE = 200;

    private final ProjectService projectService;
    private final ChangesService changesService;

    public ChangesController(ProjectService projectService, ChangesService changesService) {
        this.projectService = projectService;
        this.changesService = changesService;
    }

    /**
     * One page of pending changes, newest draft first unless {@code sort} says otherwise ({@code changedAt,asc|desc},
     * {@code displayName,asc|desc}). Filters combine: {@code type}, {@code status} and {@code locale} may repeat;
     * {@code folderUuid} limits to a folder's subtree; {@code q} matches the display name or uid.
     */
    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ChangesPageView list(
            @PathVariable String projectKey,
            @RequestParam(value = "type", required = false) List<String> types,
            @RequestParam(value = "status", required = false) List<String> statuses,
            @RequestParam(value = "locale", required = false) List<String> locales,
            @RequestParam(required = false) Long changedBy,
            @RequestParam(required = false) UUID folderUuid,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        if (page < 0 || size < 1 || size > MAX_SIZE) {
            throw new SfException(ProblemFactory.badRequest("page must be ≥ 0 and size between 1 and " + MAX_SIZE + "."));
        }
        ChangesService.Query query = new ChangesService.Query(
                parse(types, AssetType.class, AssetType::valueOf, "type"),
                parse(statuses, ReleaseStatus.class, ReleaseStatus::valueOf, "status"),
                locales == null ? Set.of() : Set.copyOf(locales),
                changedBy,
                folderUuid,
                q,
                parseSort(sort));
        ChangesService.Page result = changesService.list(projectId(projectKey), query, page, size);
        int totalPages = (int) ((result.totalElements() + size - 1) / size);
        return new ChangesPageView(
                result.rows().stream().map(ChangesController::view).toList(),
                result.page(),
                result.size(),
                result.totalElements(),
                totalPages);
    }

    /** How many pending (asset, locale) pairs there are per status, plus {@code total}. */
    @GetMapping("/count")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public Map<String, Long> count(@PathVariable String projectKey) {
        Map<String, Long> counts = new LinkedHashMap<>();
        long total = 0;
        for (Map.Entry<ReleaseStatus, Long> entry : changesService.counts(projectId(projectKey)).entrySet()) {
            counts.put(entry.getKey().name(), entry.getValue());
            total += entry.getValue();
        }
        counts.put("total", total);
        return counts;
    }

    /** The released-to-draft diff of one asset in one locale ({@code locale} omitted: the shared key). */
    @GetMapping("/{uuid}/diff")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ChangeDiffView diff(
            @PathVariable String projectKey, @PathVariable UUID uuid, @RequestParam(required = false) String locale) {
        ChangesService.Diff diff = changesService.diff(projectId(projectKey), uuid, locale);
        return new ChangeDiffView(diff.uuid(), diff.locale(), diff.status().name(), diff.changes());
    }

    private static ChangeRowView view(ChangesService.Row row) {
        return new ChangeRowView(
                row.uuid(),
                row.type().name(),
                row.uid(),
                row.displayName(),
                row.folderPath(),
                row.locale(),
                row.status().name(),
                row.changedBy(),
                row.changedAt(),
                row.releasedRevision(),
                row.releasedBy(),
                row.releasedAt(),
                null);
    }

    private static <E extends Enum<E>> Set<E> parse(
            List<String> values, Class<E> type, Function<String, E> valueOf, String name) {
        if (values == null || values.isEmpty()) {
            return Set.of();
        }
        Set<E> out = EnumSet.noneOf(type);
        for (String value : values) {
            if (value == null || value.isBlank()) {
                continue;
            }
            try {
                out.add(valueOf.apply(value.trim().toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException e) {
                throw new SfException(ProblemFactory.badRequest("Unknown " + name + ": " + value, name));
            }
        }
        return out;
    }

    private static ChangesService.Sort parseSort(String sort) {
        if (sort == null || sort.isBlank()) {
            return ChangesService.Sort.CHANGED_AT_DESC;
        }
        return switch (sort.trim().toLowerCase(Locale.ROOT)) {
            case "changedat", "changedat,desc" -> ChangesService.Sort.CHANGED_AT_DESC;
            case "changedat,asc" -> ChangesService.Sort.CHANGED_AT_ASC;
            case "displayname", "displayname,asc" -> ChangesService.Sort.NAME_ASC;
            case "displayname,desc" -> ChangesService.Sort.NAME_DESC;
            default -> throw new SfException(ProblemFactory.badRequest(
                    "Invalid sort '" + sort + "': expected changedAt or displayName, optionally with ,asc or ,desc.", "sort"));
        };
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }
}
