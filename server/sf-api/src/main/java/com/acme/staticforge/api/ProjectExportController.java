package com.acme.staticforge.api;

import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.ProjectService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Project export endpoint (spec §26.5). Streams the project's assets and media blobs as a
 * ZIP archive. Thin controller: resolves the project, delegates to
 * {@link ProjectExportImportService}, and maps the result to a downloadable attachment.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}")
public class ProjectExportController {

    private final ProjectService projectService;
    private final ProjectExportImportService exportImportService;

    public ProjectExportController(ProjectService projectService, ProjectExportImportService exportImportService) {
        this.projectService = projectService;
        this.exportImportService = exportImportService;
    }

    @GetMapping("/export")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<byte[]> export(@PathVariable String projectKey) {
        long projectId = projectService.requireByKey(projectKey).getId();
        byte[] archive = exportImportService.exportProject(projectId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(projectKey + ".zip").build().toString())
                .body(archive);
    }
}
