package com.acme.staticforge.generate.snapshot;

import com.acme.staticforge.asset.AssetType;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * An immutable, revision-pinned set of assets for a generation run (spec §18.2). Assets are indexed by {@code uuid}
 * and by numeric asset id for O(1) lookup during rendering.
 *
 * <p><b>Views and locales (M27.2.1).</b> A snapshot renders one {@link SnapshotView}. In the released view each locale
 * of a localized project sees its own released version of every releasable asset (epic decision 5), so a snapshot is
 * a family of per-locale views: {@link #in(String)} returns the view of one locale, and the family's {@link #root()}
 * is the view of the default locale (the only view of a project without locales). Every view holds every asset that
 * exists at the revision — an asset not released in the view's locale is present as an absent marker
 * ({@link SnapshotAsset#unreleased()}) — so identity lookups (uuid, asset id, type) agree across views while content
 * lookups differ. Live types are the same object in every view. The draft view has a single view for all locales.
 *
 * <p>Whatever publishes per locale must ask {@link #in(String)} with the render locale; what only needs identity may
 * use any view. The build's compile memo is keyed by {@link #root()}, so every view shares one.
 */
public final class Snapshot {

    private final long projectId;
    private final long revision;
    private final SnapshotView view;
    private final String locale;
    private final Map<UUID, SnapshotAsset> byUuid;
    private final Map<Long, SnapshotAsset> byAssetId;
    private final Snapshot root;
    private final Map<String, Snapshot> locales;

    /** A single-view draft snapshot — tests and fixtures that don't distinguish locales or release state. */
    public Snapshot(long projectId, long revision, Map<UUID, SnapshotAsset> byUuid, Map<Long, SnapshotAsset> byAssetId) {
        this(projectId, revision, SnapshotView.DRAFT, null, new Layer(byUuid, byAssetId), null, Map.of());
    }

    private Snapshot(
            long projectId,
            long revision,
            SnapshotView view,
            String locale,
            Layer layer,
            Snapshot root,
            Map<String, Snapshot> locales) {
        this.projectId = projectId;
        this.revision = revision;
        this.view = view;
        this.locale = locale;
        this.byUuid = Map.copyOf(layer.byUuid());
        this.byAssetId = Map.copyOf(layer.byAssetId());
        this.root = root == null ? this : root;
        this.locales = locales;
    }

    /** The assets of one view. */
    public record Layer(Map<UUID, SnapshotAsset> byUuid, Map<Long, SnapshotAsset> byAssetId) {}

    /**
     * A family of views.
     *
     * @param rootLocale the root view's locale: the default locale, or {@code null} for a project without locales
     * @param layers the views by locale, in the project's locale order; one entry keyed {@code rootLocale} at least
     */
    static Snapshot of(long projectId, long revision, SnapshotView view, String rootLocale, Map<String, Layer> layers) {
        Map<String, Snapshot> views = new LinkedHashMap<>();
        Snapshot root = new Snapshot(
                projectId, revision, view, rootLocale, layers.get(rootLocale), null, Collections.unmodifiableMap(views));
        layers.forEach((locale, layer) -> views.put(
                locale,
                locale == null || locale.equals(rootLocale)
                        ? root
                        : new Snapshot(projectId, revision, view, locale, layer, root, root.locales)));
        return root;
    }

    public long projectId() {
        return projectId;
    }

    public long revision() {
        return revision;
    }

    public SnapshotView view() {
        return view;
    }

    /** This view's locale; {@code null} for the view of a project without locales, and for the draft view. */
    public String locale() {
        return locale;
    }

    public Map<UUID, SnapshotAsset> byUuid() {
        return byUuid;
    }

    public Map<Long, SnapshotAsset> byAssetId() {
        return byAssetId;
    }

    /** The family's root view (the default locale's); the key of the build's compile memo. */
    public Snapshot root() {
        return root;
    }

    /**
     * The view {@code locale} renders. {@code null}, an undeclared locale and a snapshot without per-locale views give
     * the {@link #root()}; a locale is matched ignoring case, as the project declares locales.
     */
    public Snapshot in(String locale) {
        if (locale == null || root.locales.isEmpty()) {
            return root;
        }
        Snapshot exact = root.locales.get(locale);
        if (exact != null) {
            return exact;
        }
        for (Map.Entry<String, Snapshot> entry : root.locales.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(locale)) {
                return entry.getValue();
            }
        }
        return root;
    }

    /** Every view of the family, the root first when it has per-locale views. */
    public Collection<Snapshot> views() {
        return root.locales.isEmpty() ? List.of(root) : root.locales.values();
    }

    public SnapshotAsset assetByUuid(UUID uuid) {
        return byUuid.get(uuid);
    }

    public SnapshotAsset assetById(long assetId) {
        return byAssetId.get(assetId);
    }

    /** The asset as {@code locale} renders it — {@code in(locale).assetByUuid(uuid)}. */
    public SnapshotAsset asset(UUID uuid, String locale) {
        return in(locale).assetByUuid(uuid);
    }

    /** The assets of {@code type} present in this view (neither deleted nor unreleased). */
    public List<SnapshotAsset> assetsOfType(AssetType type) {
        return byUuid.values().stream()
                .filter(a -> a.type() == type)
                .filter(a -> !a.deleted())
                .toList();
    }

    /** The assets of {@code type} present in {@code locale}'s view. */
    public List<SnapshotAsset> assetsOfType(AssetType type, String locale) {
        return in(locale).assetsOfType(type);
    }

    /** The pages present in this view. */
    public List<SnapshotAsset> pages() {
        return assetsOfType(AssetType.PAGE);
    }

    /** The pages present in {@code locale}'s view: released there, in the released view. */
    public List<SnapshotAsset> pages(String locale) {
        return in(locale).pages();
    }
}
