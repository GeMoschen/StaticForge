package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.GenerationTargetRequest;
import com.acme.staticforge.api.dto.GenerationTargetView;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetLocations;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import java.util.Locale;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Generation-target endpoints (spec §18.4, §20.2). {@code generation_target} is a project config
 * table (not a revisioned content asset), so CRUD goes straight through
 * {@link GenerationTargetRepository} and allocates no revision; each write therefore refuses an archived project itself
 * ({@code 409 SF-DOM-0141}, M26).
 *
 * <p>Writes enforce two per-project invariants the generator relies on: at most one default
 * target, and no two targets whose output directories ({@link TargetLocations}) coincide or nest.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/targets")
public class TargetController {

    private final ProjectService projectService;
    private final GenerationTargetRepository targets;
    private final AuditService auditService;
    private final SecuritySupport securitySupport;

    public TargetController(
            ProjectService projectService,
            GenerationTargetRepository targets,
            AuditService auditService,
            SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.targets = targets;
        this.auditService = auditService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<GenerationTargetView> list(@PathVariable String projectKey) {
        long projectId = projectId(projectKey);
        return targets.findByProjectId(projectId).stream().map(target -> toView(projectKey, target)).toList();
    }

    @PostMapping
    @Transactional
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<GenerationTargetView> create(
            @PathVariable String projectKey, @RequestBody GenerationTargetRequest body) {
        long projectId = projectService.requireWritable(projectKey).getId();
        GenerationTarget target = new GenerationTarget(
                projectId, requireName(body.name()), parseType(body.type()), body.config(), body.isDefault());
        List<GenerationTarget> siblings = targets.findByProjectId(projectId);
        requireDistinctPath(target, siblings);
        target = targets.save(target);
        clearOtherDefaults(target, siblings);
        auditService.record(projectId, securitySupport.currentUserId(), "TARGET_CREATE", "target:" + target.getId());
        return ResponseEntity.status(org.springframework.http.HttpStatus.CREATED)
                .body(toView(projectKey, target));
    }

    @PutMapping("/{id}")
    @Transactional
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public GenerationTargetView update(
            @PathVariable String projectKey, @PathVariable Long id, @RequestBody GenerationTargetRequest body) {
        projectService.requireWritable(projectKey);
        GenerationTarget target = requireTarget(projectKey, id);
        target.setName(requireName(body.name()));
        target.setType(parseType(body.type()));
        target.setConfig(body.config());
        target.setDefaultTarget(body.isDefault());
        List<GenerationTarget> siblings = targets.findByProjectId(target.getProjectId()).stream()
                .filter(other -> !other.getId().equals(id))
                .toList();
        requireDistinctPath(target, siblings);
        target = targets.save(target);
        clearOtherDefaults(target, siblings);
        auditService.record(target.getProjectId(), securitySupport.currentUserId(), "TARGET_UPDATE", "target:" + target.getId());
        return toView(projectKey, target);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<Void> delete(@PathVariable String projectKey, @PathVariable Long id) {
        projectService.requireWritable(projectKey);
        targets.delete(requireTarget(projectKey, id));
        auditService.record(projectId(projectKey), securitySupport.currentUserId(), "TARGET_DELETE", "target:" + id);
        return ResponseEntity.noContent().build();
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private GenerationTarget requireTarget(String projectKey, Long id) {
        long projectId = projectId(projectKey);
        return targets.findById(id)
                .filter(target -> target.getProjectId() == projectId)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Generation target not found.")));
    }

    /**
     * Rejects an invalid {@code config.path} or one that coincides with / nests in a sibling's. Only
     * configured paths can clash: the {@code target-{id}} fallback is unique per id and its prefix
     * is reserved, so a not-yet-saved target (no id) needs no fallback comparison.
     */
    private static void requireDistinctPath(GenerationTarget target, List<GenerationTarget> siblings) {
        String path;
        try {
            path = TargetLocations.configuredPath(target.getConfig()).orElse(null);
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest(e.getMessage()));
        }
        if (path == null) {
            return;
        }
        for (GenerationTarget other : siblings) {
            if (TargetLocations.overlaps(path, TargetLocations.relativePath(other))) {
                throw new SfException(ProblemFactory.badRequest(
                        "Output path '" + path + "' overlaps the output of target '" + other.getName() + "'."));
            }
        }
    }

    /** Keeps at most one default target per project: the one just saved wins. */
    private void clearOtherDefaults(GenerationTarget saved, List<GenerationTarget> siblings) {
        if (!saved.isDefaultTarget()) {
            return;
        }
        for (GenerationTarget other : siblings) {
            if (other.isDefaultTarget() && !other.getId().equals(saved.getId())) {
                other.setDefaultTarget(false);
                targets.save(other);
            }
        }
    }

    private static String requireName(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty() || trimmed.length() > 120) {
            throw new SfException(ProblemFactory.badRequest("Target name is required (at most 120 characters)."));
        }
        return trimmed;
    }

    private static TargetType parseType(String type) {
        try {
            return TargetType.valueOf(type == null ? "" : type.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown generation target type: " + type));
        }
    }

    private static GenerationTargetView toView(String projectKey, GenerationTarget target) {
        return new GenerationTargetView(
                target.getId(),
                target.getUuid(),
                target.getName(),
                target.getType().name(),
                target.getConfig(),
                target.isDefaultTarget(),
                TargetLocations.outputPath(projectKey, target));
    }
}
