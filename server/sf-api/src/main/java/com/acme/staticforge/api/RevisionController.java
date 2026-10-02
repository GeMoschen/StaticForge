package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.RevisionView;
import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.DiffService;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionDiff;
import com.acme.staticforge.revision.RevisionFilter;
import com.acme.staticforge.revision.RevisionFilter;
import com.acme.staticforge.revision.RevisionService;
import java.time.Instant;
import java.util.EnumSet;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Revision listing, detail and diff (spec §20.2 Revisions). */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/revisions")
public class RevisionController {

    /** Total number of matches of a listing, before paging. */
    static final String TOTAL_COUNT_HEADER = "X-Total-Count";

    private final ProjectService projectService;
    private final RevisionService revisionService;
    private final DiffService diffService;
    private final AssetRepository assetRepository;
    private final RevisionViews views;

    public RevisionController(
            ProjectService projectService, RevisionService revisionService, DiffService diffService,
            AssetRepository assetRepository, RevisionViews views) {
        this.projectService = projectService;
        this.revisionService = revisionService;
        this.diffService = diffService;
        this.assetRepository = assetRepository;
        this.views = views;
    }

    /**
     * Revisions newest first. Every filter is applied in the database before paging: {@code since} (revision id,
     * exclusive), {@code userId}, {@code assetUuid} (UUID or uid), {@code changeType} (repeatable and/or comma-separated;
     * unknown values are {@code 400}), {@code from} (ISO-8601 instant, inclusive) and {@code to} (exclusive), and
     * {@code q} (case-insensitive substring of the comment or of a touched item's name; revisions written before names
     * were recorded match on their comment only). {@code X-Total-Count} carries the number of matches before paging.
     * The result is always ordered by revision id, descending; a {@code sort} parameter is ignored.
     */
    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ResponseEntity<List<RevisionView>> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) Long since,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) String assetUuid,
            @RequestParam(required = false) List<String> changeType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) String q,
            Pageable pageable) {
        Set<ChangeType> types = parseChangeTypes(changeType);
        long projectId = projectService.requireByKey(projectKey).getId();
        UUID resolved = resolveAssetRef(projectId, assetUuid);
        if (assetUuid != null && !assetUuid.isBlank() && resolved == null) {
            return withTotal(List.of(), 0);
        }
        Page<Revision> page = revisionService.search(
                projectId, new RevisionFilter(since, userId, resolved, types, from, to, q), pageable);
        return withTotal(views.of(projectId, page.getContent()), page.getTotalElements());
    }

    private static ResponseEntity<List<RevisionView>> withTotal(List<RevisionView> body, long total) {
        return ResponseEntity.ok().header(TOTAL_COUNT_HEADER, Long.toString(total)).body(body);
    }

    private static Set<ChangeType> parseChangeTypes(List<String> values) {
        Set<ChangeType> types = EnumSet.noneOf(ChangeType.class);
        if (values == null) {
            return types;
        }
        for (String value : values) {
            for (String part : value.split(",")) {
                if (part.isBlank()) {
                    continue;
                }
                try {
                    types.add(ChangeType.valueOf(part.strip().toUpperCase(Locale.ROOT)));
                } catch (IllegalArgumentException e) {
                    throw new SfException(ProblemFactory.badRequest("Unknown change type: " + part.strip() + ".", "changeType"));
                }
            }
        }
        return types;
    }

    /** Accepts either an asset UUID or its short UID (the "Asset" filter's placeholder promises both). Unparseable/unknown refs resolve to {@code null} rather than a 500. */
    private UUID resolveAssetRef(long projectId, String ref) {
        if (ref == null || ref.isBlank()) {
            return null;
        }
        String trimmed = ref.trim();
        try {
            return UUID.fromString(trimmed);
        } catch (IllegalArgumentException e) {
            return assetRepository.findByProjectIdAndUid(projectId, trimmed).map(Asset::getUuid).orElse(null);
        }
    }

    @GetMapping("/{revisionId}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RevisionView get(@PathVariable String projectKey, @PathVariable long revisionId) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return revisionService
                .find(projectId, revisionId)
                .map(r -> views.of(projectId, r))
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Revision not found.")));
    }

    @GetMapping("/{revisionId}/diff")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public RevisionDiff diff(@PathVariable String projectKey, @PathVariable long revisionId) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return diffService.diff(projectId, revisionId);
    }
}
