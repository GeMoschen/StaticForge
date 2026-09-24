package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ExportSelectionRequest;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.ProjectService;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Project export endpoints (spec §26.5). Streams the project's assets and media blobs as a
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
        return zipResponse(projectKey, archive);
    }

    @AllowedOnArchivedProject("Builds an export archive, changes nothing.")
    @PostMapping("/export/selection")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<byte[]> exportSelection(
            @PathVariable String projectKey, @RequestBody ExportSelectionRequest body) {
        long projectId = projectService.requireByKey(projectKey).getId();
        Set<UUID> assetUuids = parseUuids(body.assetUuids());
        Set<FolderScope> fullStores = parseFullStores(body.fullStores());
        byte[] archive = exportImportService.exportSelection(
                projectId, new ExportSelection(
                        assetUuids, body.includeChannels(), body.includeGenerationTargets(), fullStores));
        return zipResponse(projectKey, archive);
    }

    private static Set<UUID> parseUuids(Set<String> rawUuids) {
        if (rawUuids == null) {
            return null;
        }
        Set<UUID> uuids = new HashSet<>();
        for (String raw : rawUuids) {
            try {
                uuids.add(UUID.fromString(raw));
            } catch (IllegalArgumentException e) {
                throw new SfException(ProblemFactory.badRequest("Invalid asset UUID in selection: " + raw));
            }
        }
        return uuids;
    }

    private static Set<FolderScope> parseFullStores(Set<String> rawScopes) {
        if (rawScopes == null) {
            return null;
        }
        Set<FolderScope> scopes = new HashSet<>();
        for (String raw : rawScopes) {
            try {
                scopes.add(FolderScope.valueOf(raw));
            } catch (IllegalArgumentException e) {
                throw new SfException(ProblemFactory.badRequest("Invalid store scope in fullStores: " + raw));
            }
        }
        return scopes;
    }

    private static ResponseEntity<byte[]> zipResponse(String projectKey, byte[] archive) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(projectKey + ".zip").build().toString())
                .body(archive);
    }
}
