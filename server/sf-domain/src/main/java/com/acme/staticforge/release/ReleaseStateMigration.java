package com.acme.staticforge.release;

import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.project.ProjectRepository;
import com.acme.staticforge.revision.AssetChange;
import com.acme.staticforge.revision.ChangeType;
import com.acme.staticforge.revision.Revision;
import com.acme.staticforge.revision.RevisionAware;
import com.acme.staticforge.revision.RevisionService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Gives every project created before M27 its initial release state (M27.1.1, epic decision 2): each non-deleted
 * releasable asset is released in every locale key at its open version, in <strong>one</strong> revision per project
 * ({@link ChangeType#RELEASE}, no author — the system did it). After that a build of an unchanged project renders
 * exactly what it rendered before.
 *
 * <p>Run by {@code ReleaseStateInitializer} at startup rather than by a Liquibase {@code customChange}: the work needs
 * the domain's revision allocation, locale configuration and releasable-type rules, which a changeset would have to
 * duplicate in SQL. The {@code project.release_state_initialized} flag, added by the changeset with {@code false} for
 * every existing row, makes it idempotent and restartable: each project is migrated and flagged in its own
 * transaction, so a crash half way through resumes with the next unflagged project.
 *
 * <p>Archived projects are migrated too ({@link RevisionService#allocateEvenIfArchived}): unarchiving must not
 * surface a project whose content reads as never released.
 */
@Service
@RevisionAware
public class ReleaseStateMigration {

    static final String COMMENT = "Initial release state (M27)";

    private final ProjectRepository projectRepository;
    private final ProjectLocales projectLocales;
    private final AssetVersionRepository versionRepository;
    private final AssetReleaseRepository releaseRepository;
    private final RevisionService revisionService;

    public ReleaseStateMigration(
            ProjectRepository projectRepository,
            ProjectLocales projectLocales,
            AssetVersionRepository versionRepository,
            AssetReleaseRepository releaseRepository,
            RevisionService revisionService) {
        this.projectRepository = projectRepository;
        this.projectLocales = projectLocales;
        this.versionRepository = versionRepository;
        this.releaseRepository = releaseRepository;
        this.revisionService = revisionService;
    }

    /** The projects still waiting for their initial release state. */
    @Transactional(readOnly = true)
    public List<Long> pendingProjects() {
        return projectRepository.findIdsWithoutReleaseState();
    }

    /**
     * Releases every releasable asset of one project and flags the project. Returns the number of pointers opened;
     * {@code 0} (and no revision) when the project is already initialized or holds nothing releasable.
     */
    @Transactional
    public int initialize(long projectId) {
        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null || project.isReleaseStateInitialized()) {
            return 0;
        }
        LocaleConfig config = projectLocales.decode(project);
        List<AssetVersion> drafts =
                versionRepository.findOpenWithAssetByProjectAndTypeIn(projectId, ReleasableTypes.candidateTypes());

        List<AssetVersion> releasable = drafts.stream()
                .filter(v -> !v.isDeleted())
                .filter(v -> ReleasableTypes.isReleasable(v.getAsset().getAssetType(), v.getPayload(), v.getAsset().getUid()))
                .toList();
        // Pairs that already have a pointer keep it: a flag reset by hand must not duplicate open rows.
        Set<ReleasedKey> existing = releaseRepository.findByProjectIdAndValidToRevisionIsNull(projectId).stream()
                .map(p -> new ReleasedKey(p.getAssetId(), p.getLocaleKey()))
                .collect(Collectors.toSet());
        List<ReleasedKey> missing = new ArrayList<>();
        Map<Long, AssetVersion> byAsset = new HashMap<>();
        for (AssetVersion version : releasable) {
            byAsset.put(version.getAssetId(), version);
            for (String key : ReleaseLocales.keysFor(config, version.getAsset().getAssetType(), version.getPayload())) {
                ReleasedKey id = new ReleasedKey(version.getAssetId(), key);
                if (!existing.contains(id)) {
                    missing.add(id);
                }
            }
        }

        int opened = 0;
        if (!missing.isEmpty()) {
            Revision revision = revisionService.allocateEvenIfArchived(projectId, ChangeType.RELEASE, COMMENT, null);
            Instant now = Instant.now();
            List<AssetRelease> pointers = new ArrayList<>();
            for (ReleasedKey id : missing) {
                AssetVersion version = byAsset.get(id.assetId());
                pointers.add(new AssetRelease(
                        projectId,
                        version.getAssetId(),
                        id.localeKey(),
                        version.getId(),
                        version.getAsset().getUid(),
                        revision.getRevisionId(),
                        null,
                        now));
            }
            releaseRepository.saveAll(pointers);
            opened = pointers.size();
            // One entry for the whole project: listing every asset would put thousands of rows on the revision spine
            // for a change nobody made by hand.
            revisionService.appendSummary(
                    projectId,
                    revision.getRevisionId(),
                    AssetChange.create("project-" + projectId, "PROJECT", "INITIAL_RELEASE", List.of()));
        }
        project.setReleaseStateInitialized(true);
        projectRepository.save(project);
        return opened;
    }
}
