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
 * The URL of one output in one output channel, one {@link UrlArea} and one language (feature `02-url-registry`,
 * `M8.2.1`; language added by M24.3.2; every output since M32.1). Exactly one row per
 * {@code (projectId, channelKey, area, localeKey, targetType, targetUuid, variantKey, pageNumber)} tuple, and one per
 * {@code (projectId, channelKey, area, localeKey, url)} — a URL is written by one output — both enforced by unique
 * constraints. {@code localeKey} is the empty string in a project without locales and for media that isn't localized;
 * {@code channelKey} is the empty string for media, which is channel-independent.
 *
 * <p>A row is assigned once and then authoritative until a reset deletes it or an override replaces it: a build writes
 * the output at the row's URL and every link to the target uses it (M32).
 *
 * <p><b>Deliberately not revisioned.</b> Unlike {@code AssetVersion} this is a plain CRUD
 * table with no {@code validFrom}/{@code validTo} interval. {@code assignedRevision} records the project revision at
 * which the URL was first assigned for audit/debugging only, and this entity does not participate in the
 * {@code @RevisionAware}/repository-write ArchUnit convention that governs {@code Asset}/{@code AssetVersion} mutation.
 *
 * <p>{@code channelKey} and {@code targetUuid} are unenforced-by-FK value references (matching how
 * {@code OutputChannel.key} and cross-asset UUIDs are already referenced elsewhere in this schema) rather than real
 * foreign keys, so cleanup is explicit (the build's cleanup of targets that left the site, {@code AssetServiceImpl}
 * for previews).
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

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, length = 20)
    private UrlTargetType targetType;

    @Column(name = "target_uuid", nullable = false)
    private UUID targetUuid;

    /** A media variant's name; the empty string for every other row. */
    @Column(name = "variant_key", nullable = false, length = 100)
    private String variantKey = "";

    /** The page number of a paginated page's output; {@code 1} for every other row. */
    @Column(name = "page_number", nullable = false)
    private int pageNumber = 1;

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
            UrlTarget target,
            UrlArea area,
            String localeKey,
            String url,
            Instant assignedAt,
            long assignedRevision,
            boolean overridden) {
        this.projectId = projectId;
        this.channelKey = target.channelKey(channelKey);
        this.targetType = target.type();
        this.targetUuid = target.uuid();
        this.variantKey = target.variant();
        this.pageNumber = target.pageNumber();
        this.area = area;
        this.localeKey = localeKey == null ? "" : localeKey;
        this.url = url;
        this.assignedAt = assignedAt;
        this.assignedRevision = assignedRevision;
        this.overridden = overridden;
    }

    /** The output this row names. */
    public UrlTarget target() {
        return UrlTarget.of(this);
    }

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

    public String getChannelKey() {
        return channelKey;
    }

    public UrlTargetType getTargetType() {
        return targetType;
    }

    public UUID getTargetUuid() {
        return targetUuid;
    }

    public String getVariantKey() {
        return variantKey;
    }

    public int getPageNumber() {
        return pageNumber;
    }

    public UrlArea getArea() {
        return area;
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
