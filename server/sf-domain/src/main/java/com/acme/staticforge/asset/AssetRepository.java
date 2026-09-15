package com.acme.staticforge.asset;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AssetRepository extends JpaRepository<Asset, Long> {

    Optional<Asset> findByProjectIdAndUuid(long projectId, UUID uuid);

    List<Asset> findByProjectIdAndUuidIn(long projectId, Collection<UUID> uuids);

    Optional<Asset> findByProjectIdAndUid(Long projectId, String uid);

    Optional<Asset> findByProjectIdAndAssetTypeAndUid(Long projectId, AssetType assetType, String uid);
}
