package com.acme.staticforge.preferences;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One user's preferences document (M35.3); the primary key is the owning account. */
@Entity
@Table(name = "user_preferences")
public class UserPreferences {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "document", nullable = false)
    private JsonNode document;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected UserPreferences() {}

    public UserPreferences(Long userId, JsonNode document, Instant updatedAt) {
        this.userId = userId;
        this.document = document;
        this.updatedAt = updatedAt;
    }

    public Long getUserId() {
        return userId;
    }

    public JsonNode getDocument() {
        return document;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void replace(JsonNode newDocument, Instant now) {
        this.document = newDocument;
        this.updatedAt = now;
    }
}
