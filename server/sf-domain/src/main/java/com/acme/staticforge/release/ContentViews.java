package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.revision.RevisionRepository;
import org.springframework.stereotype.Service;

/** Opens {@link ContentView}s (M27.2.3). */
@Service
public class ContentViews {

    private final AssetRepository assets;
    private final AssetVersionRepository versions;
    private final AssetReleaseRepository releases;
    private final RevisionRepository revisions;
    private final ProjectLocales projectLocales;

    public ContentViews(
            AssetRepository assets,
            AssetVersionRepository versions,
            AssetReleaseRepository releases,
            RevisionRepository revisions,
            ProjectLocales projectLocales) {
        this.assets = assets;
        this.versions = versions;
        this.releases = releases;
        this.revisions = revisions;
        this.projectLocales = projectLocales;
    }

    /**
     * The view of project {@code projectId} in {@code kind} at {@code revision} (the current state when {@code null})
     * for {@code locale} (the default language when {@code null} or undeclared; ignored without locales).
     */
    public ContentView open(long projectId, Long revision, ContentView.Kind kind, String locale) {
        String key = localeKey(projectId, locale);
        long pinned = revision != null ? revision : revisions.findHeadRevisionId(projectId).orElse(0L);
        return new ContentView(projectId, pinned, revision == null, kind, key, assets, versions, releases);
    }

    /** The release key {@code locale} reads under: the declared locale, the default one, or {@code ""} without locales. */
    public String localeKey(long projectId, String locale) {
        LocaleConfig config = LocaleConfig.orEmpty(projectLocales.forProject(projectId));
        if (!config.isLocalized()) {
            return ReleaseLocales.ALL;
        }
        String declared = config.canonicalDeclared(locale);
        return declared != null ? declared : config.defaultLocale();
    }
}
