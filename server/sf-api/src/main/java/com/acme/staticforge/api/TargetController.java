package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.GenerationTargetRequest;
import com.acme.staticforge.api.dto.GenerationTargetView;
import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import java.util.Locale;
import org.springframework.http.ResponseEntity;
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
 * {@link GenerationTargetRepository} and allocates no revision.
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
        return targets.findByProjectId(projectId).stream().map(TargetController::toView).toList();
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<GenerationTargetView> create(
            @PathVariable String projectKey, @RequestBody GenerationTargetRequest body) {
        GenerationTarget target = new GenerationTarget(
                projectId(projectKey), body.name(), parseType(body.type()), body.config(), body.isDefault());
        target = targets.save(target);
        auditService.record(projectId(projectKey), securitySupport.currentUserId(), "TARGET_CREATE", "target:" + target.getId());
        return ResponseEntity.status(org.springframework.http.HttpStatus.CREATED)
                .body(toView(target));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public GenerationTargetView update(
            @PathVariable String projectKey, @PathVariable Long id, @RequestBody GenerationTargetRequest body) {
        GenerationTarget target = requireTarget(projectKey, id);
        target.setName(body.name());
        target.setType(parseType(body.type()));
        target.setConfig(body.config());
        target.setDefaultTarget(body.isDefault());
        target = targets.save(target);
        auditService.record(projectId(projectKey), securitySupport.currentUserId(), "TARGET_UPDATE", "target:" + target.getId());
        return toView(target);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<Void> delete(@PathVariable String projectKey, @PathVariable Long id) {
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

    private static TargetType parseType(String type) {
        try {
            return TargetType.valueOf(type == null ? "" : type.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown generation target type: " + type));
        }
    }

    private static GenerationTargetView toView(GenerationTarget target) {
        return new GenerationTargetView(
                target.getId(), target.getName(), target.getType().name(), target.getConfig(), target.isDefaultTarget());
    }
}
