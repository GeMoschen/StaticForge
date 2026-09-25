package com.acme.staticforge.release;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocales;
import com.acme.staticforge.revision.FieldChange;
import com.acme.staticforge.revision.JsonDiffer;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The project's Changes view (M27.1.3, epic decision 6): every (asset, locale) whose status isn't
 * {@link ReleaseStatus#PUBLISHED}, its counts, and the diff between a locale's released and draft state.
 *
 * <p>Statuses need the projections of two versions per locale, so the list never evaluates the whole project: one
 * query picks the <em>candidates</em> ({@link AssetVersionRepository#findChangeCandidates}) — drafts some locale key of
 * which doesn't point at exactly them, and tombstones with an open pointer — and only those are projected. The
 * candidate set is bounded by what has been edited since its release, not by the project size; filtering, sorting and
 * paging then run over the evaluated rows.
 */
@Service
public class ChangesService {

    private final AssetVersionRepository versionRepository;
    private final AssetRepository assetRepository;
    private final ReleaseStatusService statusService;
    private final ProjectLocales projectLocales;

    public ChangesService(
            AssetVersionRepository versionRepository,
            AssetRepository assetRepository,
            ReleaseStatusService statusService,
            ProjectLocales projectLocales) {
        this.versionRepository = versionRepository;
        this.assetRepository = assetRepository;
        this.statusService = statusService;
        this.projectLocales = projectLocales;
    }

    /** A filter of the Changes list; every {@code null} or empty field matches everything. */
    public record Query(
            Set<AssetType> types,
            Set<ReleaseStatus> statuses,
            Set<String> locales,
            Long changedBy,
            UUID folderUuid,
            String q,
            Sort sort) {}

    /** The orders the list supports; newest change first by default. */
    public enum Sort {
        CHANGED_AT_DESC,
        CHANGED_AT_ASC,
        NAME_ASC,
        NAME_DESC
    }

    /** One pending (asset, locale). */
    public record Row(
            UUID uuid,
            AssetType type,
            String uid,
            String displayName,
            String folderPath,
            String locale,
            ReleaseStatus status,
            Long changedBy,
            Instant changedAt,
            Long releasedRevision,
            Long releasedBy,
            Instant releasedAt) {}

    /** One page of rows. */
    public record Page(List<Row> rows, int page, int size, long totalElements) {}

    /** A locale's diff: the changes from its released state to its draft, in the revision-diff shape (§7.6). */
    public record Diff(UUID uuid, String locale, ReleaseStatus status, List<FieldChange> changes) {}

    /** The rows matching {@code query}, paged. */
    @Transactional(readOnly = true)
    public Page list(long projectId, Query query, int page, int size) {
        String folderPrefix = null;
        if (query.folderUuid() != null) {
            folderPrefix = folderPath(projectId, query.folderUuid());
            if (folderPrefix == null) {
                return new Page(List.of(), page, size, 0);
            }
        }
        String prefix = folderPrefix;
        List<Row> rows = rows(projectId).stream().filter(row -> matches(row, query, prefix)).toList();
        List<Row> sorted = new ArrayList<>(rows);
        sorted.sort(comparator(query.sort()));
        int from = Math.min(sorted.size(), Math.max(0, page) * size);
        int to = Math.min(sorted.size(), from + size);
        return new Page(List.copyOf(sorted.subList(from, to)), page, size, sorted.size());
    }

    /** How many pending (asset, locale) pairs the project has, per status — the nav-rail badge. */
    @Transactional(readOnly = true)
    public Map<ReleaseStatus, Long> counts(long projectId) {
        Map<ReleaseStatus, Long> counts = new EnumMap<>(ReleaseStatus.class);
        for (ReleaseStatus status : ReleaseStatus.values()) {
            if (status.isPending()) {
                counts.put(status, 0L);
            }
        }
        rows(projectId).forEach(row -> counts.merge(row.status(), 1L, Long::sum));
        return counts;
    }

    /** The diff of one asset in one locale key between its released and its draft state. */
    @Transactional(readOnly = true)
    public Diff diff(long projectId, UUID uuid, String locale) {
        Asset asset = assetRepository.findByProjectIdAndUuid(projectId, uuid)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
        AssetVersion draft = versionRepository.findByAssetIdAndValidToRevisionIsNull(asset.getId())
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("Asset not found.")));
        Map<String, LocaleRelease> statuses = statusService
                .of(projectId, List.of(new ReleaseStatusService.Draft(asset, draft)))
                .getOrDefault(asset.getId(), Map.of());
        String key = locale == null ? ReleaseLocales.ALL : locale;
        if (!statuses.containsKey(key) && statuses.containsKey(ReleaseLocales.ALL)) {
            key = ReleaseLocales.ALL;
        }
        LocaleRelease status = statuses.get(key);
        if (status == null) {
            throw new SfException(ProblemFactory.notFound("No release state for '" + asset.getUid() + "' in locale '" + key + "'."));
        }
        LocaleConfig config = projectLocales.forProject(projectId);
        JsonNode after = LocaleProjection.project(draft, asset.getUid(), key, config);
        JsonNode before = JsonNodeFactory.instance.objectNode();
        if (status.releasedVersionId() != null) {
            AssetVersion released = versionRepository.findById(status.releasedVersionId()).orElse(null);
            if (released != null) {
                before = LocaleProjection.project(released, status.releasedUid(), key, config);
            }
        }
        return new Diff(uuid, key, status.status(), JsonDiffer.diff(before, after));
    }

    /** Every pending (asset, locale) of the project, unfiltered. */
    private List<Row> rows(long projectId) {
        LocaleConfig config = projectLocales.forProject(projectId);
        long keys = config.isLocalized() ? config.codes().size() : 1;
        List<AssetVersion> candidates =
                versionRepository.findChangeCandidates(projectId, ReleasableTypes.candidateTypes(), keys);
        Map<Long, Map<String, LocaleRelease>> statuses = statusService.ofVersions(projectId, candidates);
        List<Row> rows = new ArrayList<>();
        for (AssetVersion version : candidates) {
            Map<String, LocaleRelease> locales = statuses.get(version.getAssetId());
            if (locales == null) {
                continue;
            }
            Asset asset = version.getAsset();
            for (LocaleRelease release : locales.values()) {
                if (!release.status().isPending()) {
                    continue;
                }
                rows.add(new Row(
                        asset.getUuid(),
                        asset.getAssetType(),
                        asset.getUid(),
                        version.getDisplayName(),
                        version.getFolderPath(),
                        release.localeKey(),
                        release.status(),
                        version.getChangedBy(),
                        version.getChangedAt(),
                        release.releasedRevision(),
                        release.releasedBy(),
                        release.releasedAt()));
            }
        }
        return rows;
    }

    private static boolean matches(Row row, Query query, String folderPrefix) {
        if (!isEmpty(query.types()) && !query.types().contains(row.type())) {
            return false;
        }
        if (!isEmpty(query.statuses()) && !query.statuses().contains(row.status())) {
            return false;
        }
        if (!isEmpty(query.locales()) && !query.locales().contains(row.locale())) {
            return false;
        }
        if (query.changedBy() != null && !query.changedBy().equals(row.changedBy())) {
            return false;
        }
        if (folderPrefix != null && (row.folderPath() == null || !row.folderPath().startsWith(folderPrefix))) {
            return false;
        }
        if (query.q() != null && !query.q().isBlank()) {
            String needle = query.q().trim().toLowerCase(Locale.ROOT);
            return contains(row.displayName(), needle) || contains(row.uid(), needle);
        }
        return true;
    }

    /** A folder's own path — its version's {@code folderPath} — which prefixes everything in its subtree. */
    private String folderPath(long projectId, UUID folderUuid) {
        return assetRepository.findByProjectIdAndUuid(projectId, folderUuid)
                .filter(a -> a.getAssetType() == AssetType.FOLDER)
                .flatMap(a -> versionRepository.findByAssetIdAndValidToRevisionIsNull(a.getId()))
                .map(AssetVersion::getFolderPath)
                .orElse(null);
    }

    private static boolean contains(String value, String needle) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(needle);
    }

    private static boolean isEmpty(Collection<?> values) {
        return values == null || values.isEmpty();
    }

    private static Comparator<Row> comparator(Sort sort) {
        Comparator<Row> byChangedAt = Comparator.comparing(Row::changedAt, Comparator.nullsLast(Comparator.naturalOrder()));
        Comparator<Row> byName = Comparator.comparing(
                (Row r) -> r.displayName() == null ? "" : r.displayName().toLowerCase(Locale.ROOT));
        Comparator<Row> tieBreak = Comparator.comparing((Row r) -> r.uuid().toString()).thenComparing(Row::locale);
        return switch (sort == null ? Sort.CHANGED_AT_DESC : sort) {
            case CHANGED_AT_ASC -> byChangedAt.thenComparing(tieBreak);
            case NAME_ASC -> byName.thenComparing(tieBreak);
            case NAME_DESC -> byName.reversed().thenComparing(tieBreak);
            case CHANGED_AT_DESC -> byChangedAt.reversed().thenComparing(tieBreak);
        };
    }
}
