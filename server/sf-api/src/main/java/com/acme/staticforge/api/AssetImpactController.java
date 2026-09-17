package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AssetImpactView;
import com.acme.staticforge.generate.ImpactService;
import com.acme.staticforge.generate.insight.PlanEntryRecord;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Asset impact (M22.2.2): which outputs would rebuild if an asset changed, each with its chain back to the asset. Kept
 * apart from {@code AssetController} because it is answered by the generation planner's own walk, which lives in
 * sf-generate.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/assets/{uuid}/impact")
public class AssetImpactController {

    private final ImpactService impactService;

    public AssetImpactController(ImpactService impactService) {
        this.impactService = impactService;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public AssetImpactView impact(
            @PathVariable String projectKey,
            @PathVariable UUID uuid,
            @RequestParam(required = false) String channel,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String q) {
        ImpactService.Impact impact = impactService.impact(projectKey, uuid, channel == null || channel.isBlank() ? null : channel);
        Page<PlanEntryRecord> entries =
                PlanViews.page(impact.entries(), PlanViews.filter(null, null, q), PlanViews.pageable(page, size));
        return new AssetImpactView(
                new AssetImpactView.AssetRef(impact.asset().uuid(), impact.asset().type().name(), impact.asset().uid()),
                impact.revision(),
                impact.entries().size(),
                impact.pageCount(),
                impact.byFirstEdge(),
                PlanViews.entries(entries));
    }
}
