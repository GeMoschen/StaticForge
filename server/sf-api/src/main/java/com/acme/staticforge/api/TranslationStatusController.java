package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.TranslationStatusView;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.localization.TranslationStatus;
import com.acme.staticforge.asset.localization.TranslationStatusService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.ProjectService;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Which assets are still missing translations (M24.4.2). Read-only: the status is derived from the
 * current versions on request, so it can never disagree with what the editor is looking at.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/translation-status")
public class TranslationStatusController {

    private final TranslationStatusService translationStatus;
    private final ProjectService projectService;

    public TranslationStatusController(TranslationStatusService translationStatus, ProjectService projectService) {
        this.translationStatus = translationStatus;
        this.projectService = projectService;
    }

    /**
     * Every content-holding asset's status.
     *
     * @param type restricts to one asset type ({@code PAGE}, {@code GLOBAL_SET}, {@code RECORD})
     * @param locale lists only assets missing a translation in that language — the "missing in en"
     *     filter behind the pages list
     */
    @GetMapping
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public List<TranslationStatusView> list(
            @PathVariable String projectKey,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String locale) {
        long projectId = projectService.requireByKey(projectKey).getId();
        List<TranslationStatus> statuses = translationStatus.ofProject(projectId, parseType(type));
        return statuses.stream()
                .filter(status -> matches(status, locale))
                .map(TranslationStatusController::toView)
                .toList();
    }

    /** One asset's status — what the page/record/global-set editor header shows. */
    @GetMapping("/{uuid}")
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.VIEWER + ")")
    public TranslationStatusView one(@PathVariable String projectKey, @PathVariable UUID uuid) {
        long projectId = projectService.requireByKey(projectKey).getId();
        return toView(translationStatus.of(projectId, uuid));
    }

    /** Without a language, every asset; with one, only those still missing a translation in it. */
    private static boolean matches(TranslationStatus status, String locale) {
        if (locale == null || locale.isBlank()) {
            return true;
        }
        return status.locales().stream()
                .anyMatch(entry -> entry.locale().equalsIgnoreCase(locale) && entry.missing() > 0);
    }

    private static AssetType parseType(String type) {
        if (type == null || type.isBlank()) {
            return null;
        }
        try {
            return AssetType.valueOf(type.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.badRequest("Unknown asset type: " + type));
        }
    }

    private static TranslationStatusView toView(TranslationStatus status) {
        return new TranslationStatusView(
                status.assetUuid(),
                status.locales().stream()
                        .map(entry -> new TranslationStatusView.LocaleStatusView(
                                entry.locale(), entry.missing(), entry.total()))
                        .toList(),
                status.orphaned());
    }
}
