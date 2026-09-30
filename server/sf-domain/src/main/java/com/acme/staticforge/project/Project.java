package com.acme.staticforge.project;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Project — the top-level isolation boundary (spec §8.1, §22.2). */
@Entity
@Table(name = "project")
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_key", nullable = false, unique = true, length = 40)
    private String key;

    @Column(name = "name", nullable = false, length = 200)
    private String name;

    @Lob
    @Column(name = "description")
    private String description;

    @Column(name = "archived", nullable = false)
    private boolean archived;

    /** Comma-joined MIME allow-list patterns overriding {@code sf.media.allowed-mime} for this project; {@code null}/blank means "use the instance-wide default". */
    @Lob
    @Column(name = "allowed_mime_types")
    private String allowedMimeTypes;

    /** Content locale configuration (M24), {@code null} for a single-language project. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "locale_config")
    private JsonNode localeConfig;

    /**
     * What editors may do to put content online (M28, {@code {"editor": [...]}}); read through
     * {@link com.acme.staticforge.project.publish.PublishPolicy#fromJson}. A new project opens nothing.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "publish_policy", nullable = false)
    private JsonNode publishPolicy = com.acme.staticforge.project.publish.PublishPolicy.EMPTY.toJson();

    /**
     * Revision compaction (M29.4.1, spec §7.7): {@code {"enabled", "olderThanDays", "enabledAt", "enabledBy"}}, read
     * through {@link com.acme.staticforge.revision.compaction.CompactionPolicy#fromJson}; {@code null} = off.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "compaction_policy")
    private JsonNode compactionPolicy;

    /**
     * The quality rule configuration (M30.1.2): {@code {"rules": {code: {"severity", "params"}}}} with only the entries
     * that differ from a rule's default; {@code null} = every rule at its default.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "quality_rule_config")
    private JsonNode qualityRuleConfig;

    /**
     * Code highlighting overrides (M33 follow-up): {@code {"extensions": {…}, "mimeTypes": {…}}}, read through
     * {@link CodeHighlighting#fromJson}; {@code null} = built-in detection only.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "code_highlighting")
    private JsonNode codeHighlighting;

    /**
     * The newest revision the revision-compaction job has processed (M29.4.1), {@code null} when it never ran. Written
     * only by {@code RevisionCompactor} (JDBC), so this mapping is read-only: a project save never overwrites it.
     */
    @Column(name = "compacted_through", insertable = false, updatable = false)
    private Long compactedThrough;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

    /**
     * {@code true} once every releasable asset that existed before M27 has its release pointers (M27.1.1). A new
     * project starts empty, so it is created initialized; rows migrated from before M27 start {@code false} until
     * {@code ReleaseStateInitializer} has run for them.
     */
    @Column(name = "release_state_initialized", nullable = false)
    private boolean releaseStateInitialized = true;

    protected Project() {}

    public Project(String key, String name, Instant createdAt, Long createdBy) {
        this.key = key;
        this.name = name;
        this.createdAt = createdAt;
        this.createdBy = createdBy;
    }

    public Long getId() {
        return id;
    }

    public String getKey() {
        return key;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public boolean isArchived() {
        return archived;
    }

    public void setArchived(boolean archived) {
        this.archived = archived;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public JsonNode getLocaleConfig() {
        return localeConfig;
    }

    public void setLocaleConfig(JsonNode localeConfig) {
        this.localeConfig = localeConfig;
    }

    public String getAllowedMimeTypes() {
        return allowedMimeTypes;
    }

    public void setAllowedMimeTypes(String allowedMimeTypes) {
        this.allowedMimeTypes = allowedMimeTypes;
    }

    public JsonNode getPublishPolicy() {
        return publishPolicy;
    }

    public void setPublishPolicy(JsonNode publishPolicy) {
        this.publishPolicy = publishPolicy;
    }

    public JsonNode getCompactionPolicy() {
        return compactionPolicy;
    }

    public void setCompactionPolicy(JsonNode compactionPolicy) {
        this.compactionPolicy = compactionPolicy;
    }

    public JsonNode getQualityRuleConfig() {
        return qualityRuleConfig;
    }

    public void setQualityRuleConfig(JsonNode qualityRuleConfig) {
        this.qualityRuleConfig = qualityRuleConfig;
    }

    public JsonNode getCodeHighlighting() {
        return codeHighlighting;
    }

    public void setCodeHighlighting(JsonNode codeHighlighting) {
        this.codeHighlighting = codeHighlighting;
    }

    public Long getCompactedThrough() {
        return compactedThrough;
    }

    public boolean isReleaseStateInitialized() {
        return releaseStateInitialized;
    }

    public void setReleaseStateInitialized(boolean releaseStateInitialized) {
        this.releaseStateInitialized = releaseStateInitialized;
    }

    /** Parses {@link #getAllowedMimeTypes()} into a list, empty when unset. */
    public java.util.List<String> allowedMimeTypesList() {
        if (allowedMimeTypes == null || allowedMimeTypes.isBlank()) {
            return java.util.List.of();
        }
        return java.util.Arrays.stream(allowedMimeTypes.split(","))
                .map(String::trim)
                .filter(p -> !p.isBlank())
                .toList();
    }
}
