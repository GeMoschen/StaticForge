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

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false)
    private Long createdBy;

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
