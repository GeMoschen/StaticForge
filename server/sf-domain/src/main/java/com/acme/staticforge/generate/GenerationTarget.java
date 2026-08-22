package com.acme.staticforge.generate;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A reusable output destination for generation runs (spec §18.4). {@code type} is stored
 * as the plain {@link TargetType} name; {@code config} holds the backend-specific options
 * (filesystem prefix, S3 bucket/path, ZIP layout, ...).
 */
@Entity
@Table(name = "generation_target")
public class GenerationTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private long projectId;

    @Column(name = "name", nullable = false, length = 120)
    private String name;

    @Column(name = "type", nullable = false, length = 20)
    private String type;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "config")
    private JsonNode config;

    @Column(name = "is_default", nullable = false)
    private boolean defaultTarget;

    protected GenerationTarget() {}

    public GenerationTarget(long projectId, String name, TargetType type, JsonNode config, boolean defaultTarget) {
        this.projectId = projectId;
        this.name = name;
        this.type = type.name();
        this.config = config;
        this.defaultTarget = defaultTarget;
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

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public TargetType getType() {
        return TargetType.valueOf(type);
    }

    public void setType(TargetType type) {
        this.type = type.name();
    }

    public JsonNode getConfig() {
        return config;
    }

    public void setConfig(JsonNode config) {
        this.config = config;
    }

    public boolean isDefaultTarget() {
        return defaultTarget;
    }

    public void setDefaultTarget(boolean defaultTarget) {
        this.defaultTarget = defaultTarget;
    }
}
