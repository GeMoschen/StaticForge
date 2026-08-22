package com.acme.staticforge.channel;

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
 * An output channel — a named render target for a project (spec §15.2). {@code html} is
 * created with every project and cannot be deleted (only disabled); further channels
 * ({@code markdown}, {@code amp}, …) are fully CRUD-managed. {@code default_escaping} stores
 * the plain {@link com.acme.staticforge.template.render.Escaping} name; {@code settings} holds
 * per-channel output options (index file name, URL strategy, pretty/minify, …).
 */
@Entity
@Table(name = "output_channel")
public class OutputChannel {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private long projectId;

    // `key` is a reserved word in several SQL dialects (H2, …), so Hibernate must quote it;
    // the backtick form is Hibernate's documented "quote this identifier" marker.
    @Column(name = "`key`", nullable = false, length = 40)
    private String key;

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "file_extension", length = 10)
    private String fileExtension;

    @Column(name = "mime_type", length = 100)
    private String mimeType;

    @Column(name = "default_escaping", length = 20)
    private String defaultEscaping;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "is_default", nullable = false)
    private boolean defaultChannel;

    @Column(name = "position", nullable = false)
    private int position;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings")
    private JsonNode settings;

    protected OutputChannel() {}

    public OutputChannel(
            long projectId,
            String key,
            String name,
            String fileExtension,
            String mimeType,
            String defaultEscaping,
            boolean enabled,
            boolean defaultChannel,
            int position,
            JsonNode settings) {
        this.projectId = projectId;
        this.key = key;
        this.name = name;
        this.fileExtension = fileExtension;
        this.mimeType = mimeType;
        this.defaultEscaping = defaultEscaping;
        this.enabled = enabled;
        this.defaultChannel = defaultChannel;
        this.position = position;
        this.settings = settings;
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

    public String getKey() {
        return key;
    }

    public void setKey(String key) {
        this.key = key;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getFileExtension() {
        return fileExtension;
    }

    public void setFileExtension(String fileExtension) {
        this.fileExtension = fileExtension;
    }

    public String getMimeType() {
        return mimeType;
    }

    public void setMimeType(String mimeType) {
        this.mimeType = mimeType;
    }

    public String getDefaultEscaping() {
        return defaultEscaping;
    }

    public void setDefaultEscaping(String defaultEscaping) {
        this.defaultEscaping = defaultEscaping;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isDefaultChannel() {
        return defaultChannel;
    }

    public void setDefaultChannel(boolean defaultChannel) {
        this.defaultChannel = defaultChannel;
    }

    public int getPosition() {
        return position;
    }

    public void setPosition(int position) {
        this.position = position;
    }

    public JsonNode getSettings() {
        return settings;
    }

    public void setSettings(JsonNode settings) {
        this.settings = settings;
    }
}
