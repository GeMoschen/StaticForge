package com.acme.staticforge.redirect;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/**
 * One entry of a project's redirect registry (M30.4.1, epic decision 14): the output path {@code fromPath} of one
 * channel and locale redirects either to a page ({@code toAssetUuid} + {@code toPageNumber}, resolved at build time to
 * the page's current output path in the same channel and locale, so chains collapse and later moves follow) or to a
 * fixed {@code toPath} (an output path or an absolute {@code http(s)} URL). Exactly one of the two targets is set
 * (DB check {@code ck_redirect_one_target}); {@code (projectId, channelKey, localeKey, fromPath)} is unique.
 *
 * <p>Not revisioned (like {@code UrlRegistryEntry}): redirects are not part of time travel or project restore.
 * {@code version} is the optimistic lock behind {@code If-Match}.
 */
@Entity
@Table(name = "redirect")
public class RedirectEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private long projectId;

    @Column(name = "channel_key", nullable = false, length = 40)
    private String channelKey;

    /** The empty string in a project without locales. */
    @Column(name = "locale_key", nullable = false, length = 40)
    private String localeKey = "";

    @Column(name = "from_path", nullable = false, length = 1000)
    private String fromPath;

    @Column(name = "to_asset_uuid")
    private UUID toAssetUuid;

    @Column(name = "to_page_number")
    private Integer toPageNumber;

    @Column(name = "to_path", length = 2000)
    private String toPath;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, length = 10)
    private RedirectKind kind;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "source_run_id")
    private Long sourceRunId;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by")
    private Long updatedBy;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    protected RedirectEntry() {}

    public RedirectEntry(
            long projectId, String channelKey, String localeKey, String fromPath, RedirectKind kind, Instant createdAt,
            Long createdBy) {
        this.projectId = projectId;
        this.channelKey = channelKey;
        this.localeKey = localeKey == null ? "" : localeKey;
        this.fromPath = fromPath;
        this.kind = kind;
        this.createdAt = createdAt;
        this.createdBy = createdBy;
        this.updatedAt = createdAt;
        this.updatedBy = createdBy;
    }

    /** Points the entry at page {@code pageNumber} of {@code assetUuid}; clears a fixed target. */
    public void targetAsset(UUID assetUuid, int pageNumber) {
        this.toAssetUuid = assetUuid;
        this.toPageNumber = pageNumber;
        this.toPath = null;
    }

    /** Points the entry at a fixed output path or URL; clears a page target. */
    public void targetPath(String path) {
        this.toAssetUuid = null;
        this.toPageNumber = null;
        this.toPath = path;
    }

    /** The entry as the resolver reads it. */
    public RedirectRule rule() {
        return new RedirectRule(id, channelKey, localeKey, fromPath, toAssetUuid, toPageNumber, toPath);
    }

    public Long getId() {
        return id;
    }

    public long getProjectId() {
        return projectId;
    }

    public String getChannelKey() {
        return channelKey;
    }

    public void setChannelKey(String channelKey) {
        this.channelKey = channelKey;
    }

    public String getLocaleKey() {
        return localeKey;
    }

    public void setLocaleKey(String localeKey) {
        this.localeKey = localeKey == null ? "" : localeKey;
    }

    public String getFromPath() {
        return fromPath;
    }

    public void setFromPath(String fromPath) {
        this.fromPath = fromPath;
    }

    public UUID getToAssetUuid() {
        return toAssetUuid;
    }

    public Integer getToPageNumber() {
        return toPageNumber;
    }

    public String getToPath() {
        return toPath;
    }

    public RedirectKind getKind() {
        return kind;
    }

    public void setKind(RedirectKind kind) {
        this.kind = kind;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public Long getSourceRunId() {
        return sourceRunId;
    }

    public void setSourceRunId(Long sourceRunId) {
        this.sourceRunId = sourceRunId;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public Long getUpdatedBy() {
        return updatedBy;
    }

    /** Records who changed the entry and when. */
    public void touched(Instant at, Long by) {
        this.updatedAt = at;
        this.updatedBy = by;
    }

    public long getVersion() {
        return version;
    }
}
