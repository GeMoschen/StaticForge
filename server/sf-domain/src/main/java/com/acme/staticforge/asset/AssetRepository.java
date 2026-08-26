package com.acme.staticforge.asset;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AssetRepository extends JpaRepository<Asset, Long> {

    Optional<Asset> findByProjectIdAndUuid(long projectId, UUID uuid);

    Optional<Asset> findByProjectIdAndUid(Long projectId, String uid);

    Optional<Asset> findByProjectIdAndAssetTypeAndUid(Long projectId, AssetType assetType, String uid);
}
