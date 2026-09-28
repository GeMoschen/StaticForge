package com.acme.staticforge.asset.navigation;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * A {@link NavigationLookup} resolving for one channel (M31): the assets of {@code delegate}, with the channel's
 * {@code indexUid} as the fallback index page of a folder without a start page. Made by
 * {@link NavigationLookup#withIndexUid}.
 */
record ChannelNavigationLookup(NavigationLookup delegate, String indexUid) implements NavigationLookup {

    @Override
    public Optional<NavigationAsset> byUuid(long projectId, UUID uuid) {
        return delegate.byUuid(projectId, uuid);
    }

    @Override
    public List<NavigationAsset> childrenOf(long projectId, UUID folderUuid) {
        return delegate.childrenOf(projectId, folderUuid);
    }

    @Override
    public NavigationLookup withIndexUid(String indexUid) {
        return delegate.withIndexUid(indexUid);
    }
}
