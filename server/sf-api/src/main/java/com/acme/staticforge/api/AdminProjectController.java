package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.AdminProjectRow;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectOverviewService;
import com.acme.staticforge.project.ProjectOverviewService.ProjectOverview;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Instance administration of projects (M26.3.1): {@code GET /api/v1/admin/projects}, instance admins only. Archiving
 * and unarchiving stay on {@code /projects/{key}/archive} and {@code /unarchive}.
 */
@RestController
@RequestMapping("/api/v1/admin/projects")
@PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
public class AdminProjectController {

    private final ProjectOverviewService overviewService;

    public AdminProjectController(ProjectOverviewService overviewService) {
        this.overviewService = overviewService;
    }

    /**
     * Every project sorted by key, with its member count and last change. {@code q} matches key, name and description
     * ignoring case; archived projects are included unless {@code includeArchived=false}.
     */
    @GetMapping
    public List<AdminProjectRow> list(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "true") boolean includeArchived) {
        return overviewService.overview(q, includeArchived).stream().map(AdminProjectController::toRow).toList();
    }

    private static AdminProjectRow toRow(ProjectOverview overview) {
        Project project = overview.project();
        return new AdminProjectRow(
                project.getKey(),
                project.getName(),
                project.getDescription(),
                project.isArchived(),
                project.getCreatedAt(),
                overview.memberCount(),
                overview.headRevision(),
                overview.lastChangeAt());
    }
}
