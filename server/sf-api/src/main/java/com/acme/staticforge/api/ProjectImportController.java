package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ImportResultView;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.exportimport.ImportResult;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.SecuritySupport;
import java.io.IOException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Project import endpoint (spec §26.5). Accepts a ZIP archive (multipart) produced by
 * {@link ProjectExportController} and recreates the exported assets in the target project
 * with fresh UUIDs and import provenance. Mutations flow through the real service layer so
 * every imported asset is a revisioned, attributable change.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}")
public class ProjectImportController {

    private final ProjectService projectService;
    private final ProjectExportImportService exportImportService;
    private final SecuritySupport securitySupport;

    public ProjectImportController(
            ProjectService projectService,
            ProjectExportImportService exportImportService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.exportImportService = exportImportService;
        this.securitySupport = securitySupport;
    }

    @PostMapping("/import")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ImportResultView importArchive(
            @PathVariable String projectKey, @RequestParam("file") MultipartFile file) {
        long projectId = projectService.requireByKey(projectKey).getId();
        RevisionContext ctx = RevisionContext.of(projectId, securitySupport.currentUserId(), "import project");
        ImportResult result = exportImportService.importProject(projectId, bytes(file), ctx);
        return new ImportResultView(
                result.sourceProjectKey(), result.importedAssetCount(), result.importedBlobCount());
    }

    private static byte[] bytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            throw new SfException(
                    ProblemFactory.badRequest("Failed to read import archive."), e.getMessage(), e);
        }
    }
}
