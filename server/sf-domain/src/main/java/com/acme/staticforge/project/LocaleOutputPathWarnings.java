package com.acme.staticforge.project;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.channel.OutputPathExpander;
import java.util.Comparator;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@code SF-GEN-0112} warnings of a language setup (M35.1): once a project has languages, a build needs
 * {@code {locale}} in the output path of every page template channel ({@code SF-GEN-0111} otherwise). The check is
 * {@link OutputPathExpander#notLocaleDistinct} — the one the template warnings use.
 */
@Component
public class LocaleOutputPathWarnings {

    private final AssetVersionRepository versions;

    public LocaleOutputPathWarnings(AssetVersionRepository versions) {
        this.versions = versions;
    }

    /**
     * The page template channels of the project whose output path lacks {@code {locale}} under {@code locales}, by
     * template name then channel; empty when {@code locales} declares no language. One query whatever the count.
     */
    @Transactional(readOnly = true)
    public List<ProjectService.OutputPathWarning> forProject(long projectId, LocaleConfig locales) {
        if (!LocaleConfig.orEmpty(locales).isLocalized()) {
            return List.of();
        }
        return versions.findOpenWithAssetByProjectAndTypeIn(projectId, List.of(AssetType.PAGE_TEMPLATE)).stream()
                .filter(version -> !version.isDeleted())
                .sorted(Comparator.comparing(AssetVersion::getDisplayName, String.CASE_INSENSITIVE_ORDER))
                .flatMap(version -> OutputPathExpander.notLocaleDistinct(version.getPayload().get("outputPath")).stream()
                        .map(path -> new ProjectService.OutputPathWarning(
                                version.getAsset().getUuid(),
                                version.getAsset().getUid(),
                                version.getDisplayName(),
                                path.channel(),
                                path.expression(),
                                path.message())))
                .toList();
    }
}
