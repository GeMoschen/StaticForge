package com.acme.staticforge.preview;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.navigation.NavigationAsset;
import com.acme.staticforge.asset.navigation.NavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationServiceImpl;
import com.acme.staticforge.release.ContentView;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * {@link NavigationLookup} over a preview's {@link ContentView} (M27.2.3): navigation shows what the rest of the page
 * shows — the drafts or the release state, at the preview's revision (a revision preview used to read the current
 * navigation). An asset absent from the view (deleted, or not released in its language) is absent from navigation.
 * {@code projectId} is the view's; the argument only satisfies the interface.
 *
 * <p>Like generation's snapshot lookup, the published view leaves out a page reference that resolves to nothing only
 * because its target isn't released in the language — absent from that language's navigation, not a dangling
 * reference that fails the preview.
 */
final class ContentViewNavigationLookup implements NavigationLookup {

    private final ContentView view;
    private final NavigationServiceImpl navigation = new NavigationServiceImpl();
    private ContentViewNavigationLookup draft;

    ContentViewNavigationLookup(ContentView view) {
        this.view = view;
    }

    @Override
    public Optional<NavigationAsset> byUuid(long projectId, UUID uuid) {
        return view.resolve(uuid).map(ContentViewNavigationLookup::toNavigationAsset);
    }

    @Override
    public List<NavigationAsset> childrenOf(long projectId, UUID folderUuid) {
        return view.resolve(folderUuid)
                .map(folder -> view.children(folder.asset()).stream()
                        .filter(child -> !hiddenByRelease(child))
                        .map(ContentViewNavigationLookup::toNavigationAsset)
                        .toList())
                .orElseGet(List::of);
    }

    private boolean hiddenByRelease(ContentView.Resolved child) {
        if (view.kind() != ContentView.Kind.PUBLISHED || child.asset().getAssetType() != AssetType.PAGE_REFERENCE) {
            return false;
        }
        UUID uuid = child.asset().getUuid();
        if (navigation.resolve(view.projectId(), uuid, this) != null) {
            return false;
        }
        if (draft == null) {
            draft = new ContentViewNavigationLookup(view.asDraft());
        }
        return navigation.resolve(view.projectId(), uuid, draft) != null;
    }

    private static NavigationAsset toNavigationAsset(ContentView.Resolved found) {
        return new NavigationAsset(
                found.asset().getUuid(),
                found.asset().getAssetType(),
                found.uid(),
                found.version().getDisplayName(),
                found.version().getPayload());
    }
}
