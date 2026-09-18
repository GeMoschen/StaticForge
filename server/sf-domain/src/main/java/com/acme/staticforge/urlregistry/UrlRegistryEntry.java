package com.acme.staticforge.urlregistry;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A cached URL assignment for one {@code PageReference} in one output channel, one
 * {@link UrlArea} and one language (feature `02-url-registry`, `M8.2.1`; language added by
 * M24.3.2). Exactly one live row per
 * {@code (projectId, channelKey, pageReferenceUuid, area, localeKey)} tuple, enforced by a DB
 * unique constraint. {@code localeKey} is the empty string in a project without locales, so
 * pre-M24 rows keep their identity.
 *
 * <p><b>Deliberately not revisioned.</b> Unlike {@code AssetVersion} this is a plain CRUD
 * table with no {@code validFrom}/{@code validTo} interval: a URL is assigned once by
 * {@code M8.2.2} and then read-cached until an explicit reset performs an in-place delete
 * (see {@link UrlRegistryRepository}'s {@code deleteBy*} methods) so the next access
 * recomputes it. {@code assignedRevision} records the project revision at which the URL was
 * first computed for audit/debugging only — it is never used to invalidate the row, and this
 * entity does not participate in the {@code @RevisionAware}/repository-write ArchUnit
 * convention that governs {@code Asset}/{@code AssetVersion} mutation.
 *
 * <p>{@code channelKey} and {@code pageReferenceUuid} are unenforced-by-FK value references
 * (matching how {@code OutputChannel.key} and cross-asset UUIDs are already referenced
 * elsewhere in this schema, e.g. {@code PageReference.target.assetUuid} inside the asset
 * payload JSON) rather than real foreign keys — {@code asset(id)} is the only column this
 * schema puts real FKs on, never {@code asset(uuid)}. Cleanup on {@code PageReference}
 * deletion is therefore explicit (see {@code AssetServiceImpl#softDelete}), not
 * {@code ON DELETE CASCADE}.
 */
@Entity
@Table(name = "url_registry_entry")
public class UrlRegistryEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private long projectId;

    @Column(name = "channel_key", nullable = false, length = 40)
    private String channelKey;

    @Column(name = "page_reference_uuid", nullable = false)
    private UUID pageReferenceUuid;

    @Enumerated(EnumType.STRING)
    @Column(name = "area", nullable = false, length = 20)
    private UrlArea area;

    /** The language this URL is for; the empty string in a project without locales (M24.3.2). */
    @Column(name = "locale_key", nullable = false, length = 40)
    private String localeKey = "";

    @Column(name = "url", nullable = false, length = 1000)
    private String url;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;

    @Column(name = "assigned_revision", nullable = false)
    private long assignedRevision;

    @Column(name = "overridden", nullable = false)
    private boolean overridden;

    protected UrlRegistryEntry() {}

    public UrlRegistryEntry(
            long projectId,
            String channelKey,
            UUID pageReferenceUuid,
            UrlArea area,
            String url,
            Instant assignedAt,
            long assignedRevision,
            boolean overridden) {
        this(projectId, channelKey, pageReferenceUuid, area, "", url, assignedAt, assignedRevision, overridden);
    }

    public UrlRegistryEntry(
            long projectId,
            String channelKey,
            UUID pageReferenceUuid,
            UrlArea area,
            String localeKey,
            String url,
            Instant assignedAt,
            long assignedRevision,
            boolean overridden) {
        this.projectId = projectId;
        this.channelKey = channelKey;
        this.pageReferenceUuid = pageReferenceUuid;
        this.area = area;
        this.localeKey = localeKey == null ? "" : localeKey;
        this.url = url;
        this.assignedAt = assignedAt;
        this.assignedRevision = assignedRevision;
        this.overridden = overridden;
    }

    /** The language this URL is for; the empty string in a project without locales. */
    public String getLocaleKey() {
        return localeKey;
    }

    public void setLocaleKey(String localeKey) {
        this.localeKey = localeKey == null ? "" : localeKey;
    }

    public Long getId() {
        return id;
    }

    public long getProjectId() {
        return projectId;
    }

    public void setProjectId(long projectId) {
        this.projectId = projectId;
    }

    public String getChannelKey() {
        return channelKey;
    }

    public void setChannelKey(String channelKey) {
        this.channelKey = channelKey;
    }

    public UUID getPageReferenceUuid() {
        return pageReferenceUuid;
    }

    public void setPageReferenceUuid(UUID pageReferenceUuid) {
        this.pageReferenceUuid = pageReferenceUuid;
    }

    public UrlArea getArea() {
        return area;
    }

    public void setArea(UrlArea area) {
        this.area = area;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public Instant getAssignedAt() {
        return assignedAt;
    }

    public void setAssignedAt(Instant assignedAt) {
        this.assignedAt = assignedAt;
    }

    public long getAssignedRevision() {
        return assignedRevision;
    }

    public void setAssignedRevision(long assignedRevision) {
        this.assignedRevision = assignedRevision;
    }

    public boolean isOverridden() {
        return overridden;
    }

    public void setOverridden(boolean overridden) {
        this.overridden = overridden;
    }
}
