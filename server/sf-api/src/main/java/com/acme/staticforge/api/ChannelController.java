package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChannelCreateRequest;
import com.acme.staticforge.api.dto.ChannelDeletePreview;
import com.acme.staticforge.api.dto.ChannelUpdateRequest;
import com.acme.staticforge.api.dto.ChannelView;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.channel.DeletePreview;
import com.acme.staticforge.channel.OutputChannel;
import com.acme.staticforge.channel.UpdateChannelRequest;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.security.SecuritySupport;
import java.util.List;
import org.springframework.http.HttpStatus;
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
 * Output-channel endpoints (spec §15.3, §20.2). Thin controller: resolves the project,
 * authorizes, delegates to {@link ChannelService}, and maps to channel DTOs. {@code html} cannot
 * be deleted (only disabled); deletion is blocked while templates still carry a channel template
 * for the key, surfaced as a 409 listing the affected templates.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/channels")
public class ChannelController {

    private final ProjectService projectService;
    private final ChannelService channelService;
    private final SecuritySupport securitySupport;

    public ChannelController(ProjectService projectService, ChannelService channelService, SecuritySupport securitySupport) {
        this.projectService = projectService;
        this.channelService = channelService;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<ChannelView> list(@PathVariable String projectKey) {
        return channelService.list(projectId(projectKey)).stream().map(ChannelController::toView).toList();
    }

    @PostMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ResponseEntity<ChannelView> create(
            @PathVariable String projectKey, @RequestBody ChannelCreateRequest body) {
        OutputChannel channel = channelService.create(
                projectId(projectKey),
                new CreateChannelRequest(
                        body.key(), body.name(), body.fileExtension(), body.mimeType(), body.defaultEscaping(),
                        body.enabled(), body.isDefault(), body.position(), body.settings(), body.copyFrom()),
                securitySupport.currentUserId(),
                null);
        return ResponseEntity.status(HttpStatus.CREATED).body(toView(channel));
    }

    @PutMapping("/{key}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ChannelView update(
            @PathVariable String projectKey, @PathVariable String key, @RequestBody ChannelUpdateRequest body) {
        OutputChannel channel = channelService.update(
                projectId(projectKey),
                key,
                new UpdateChannelRequest(
                        body.name(), body.fileExtension(), null, body.defaultEscaping(), body.enabled(),
                        body.isDefault(), body.position(), body.settings()),
                securitySupport.currentUserId());
        return toView(channel);
    }

    @GetMapping("/{key}/delete-preview")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public ChannelDeletePreview deletePreview(@PathVariable String projectKey, @PathVariable String key) {
        DeletePreview preview = channelService.previewDelete(projectId(projectKey), key);
        return new ChannelDeletePreview(preview.affectedTemplates().stream()
                .map(t -> new ChannelDeletePreview.ChannelTemplateRef(t.uuid(), t.uid(), t.displayName()))
                .toList());
    }

    @DeleteMapping("/{key}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")
    public ResponseEntity<Void> delete(@PathVariable String projectKey, @PathVariable String key) {
        channelService.delete(projectId(projectKey), key, securitySupport.currentUserId(), null);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{key}/enable")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ChannelView enable(@PathVariable String projectKey, @PathVariable String key) {
        return toView(channelService.setEnabled(projectId(projectKey), key, true, securitySupport.currentUserId()));
    }

    @PostMapping("/{key}/disable")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public ChannelView disable(@PathVariable String projectKey, @PathVariable String key) {
        return toView(channelService.setEnabled(projectId(projectKey), key, false, securitySupport.currentUserId()));
    }

    private long projectId(String key) {
        return projectService.requireByKey(key).getId();
    }

    private static ChannelView toView(OutputChannel channel) {
        return new ChannelView(
                channel.getKey(),
                channel.getName(),
                channel.getFileExtension(),
                channel.getMimeType(),
                channel.getDefaultEscaping(),
                channel.isEnabled(),
                channel.isDefaultChannel(),
                channel.getPosition(),
                channel.getSettings());
    }
}
