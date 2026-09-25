package com.acme.staticforge.scheduler;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * An (asset, locale) a scheduled action touches (M27.4.4), written from {@link ScheduledActionHandler#assets} whenever
 * the action is saved. It answers "which pending actions touch these assets" (the {@code scheduled} block of asset
 * views, the {@code assetUuid} filter) with one indexed query. {@code localeKey} {@code ""} = every locale.
 */
@Entity
@Table(name = "scheduled_action_asset")
@IdClass(ScheduledActionAsset.Key.class)
public class ScheduledActionAsset {

    @Id
    @Column(name = "action_id", nullable = false)
    private Long actionId;

    @Id
    @Column(name = "asset_uuid", nullable = false)
    private UUID assetUuid;

    @Id
    @Column(name = "locale_key", nullable = false, length = 35)
    private String localeKey;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    protected ScheduledActionAsset() {}

    public ScheduledActionAsset(long actionId, long projectId, UUID assetUuid, String localeKey) {
        this.actionId = actionId;
        this.projectId = projectId;
        this.assetUuid = assetUuid;
        this.localeKey = localeKey == null ? "" : localeKey;
    }

    public Long getActionId() {
        return actionId;
    }

    public UUID getAssetUuid() {
        return assetUuid;
    }

    public String getLocaleKey() {
        return localeKey;
    }

    public Long getProjectId() {
        return projectId;
    }

    /** The composite key. */
    public static class Key implements Serializable {
        private Long actionId;
        private UUID assetUuid;
        private String localeKey;

        public Key() {}

        public Key(Long actionId, UUID assetUuid, String localeKey) {
            this.actionId = actionId;
            this.assetUuid = assetUuid;
            this.localeKey = localeKey;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key k
                    && Objects.equals(actionId, k.actionId)
                    && Objects.equals(assetUuid, k.assetUuid)
                    && Objects.equals(localeKey, k.localeKey);
        }

        @Override
        public int hashCode() {
            return Objects.hash(actionId, assetUuid, localeKey);
        }
    }
}
