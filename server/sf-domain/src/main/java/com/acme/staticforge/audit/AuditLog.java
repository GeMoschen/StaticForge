package com.acme.staticforge.audit;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An audit trail entry (spec §26.3). Revisions trace content changes; this separate, append-only
 * table traces security-relevant events that are not revisioned content: authentication and
 * membership, channel and generation-target administration. {@code detail} carries opaque,
 * event-specific context as JSON.
 */
@Entity
@Table(name = "audit_log")
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id")
    private Long projectId;

    @Column(name = "actor_user_id")
    private Long actorUserId;

    @Column(name = "action", nullable = false, length = 64)
    private String action;

    @Column(name = "target", length = 255)
    private String target;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "detail")
    private JsonNode detail;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected AuditLog() {}

    public AuditLog(Long projectId, Long actorUserId, String action, String target, JsonNode detail, Instant createdAt) {
        this.projectId = projectId;
        this.actorUserId = actorUserId;
        this.action = action;
        this.target = target;
        this.detail = detail;
        this.createdAt = createdAt;
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public Long getActorUserId() {
        return actorUserId;
    }

    public String getAction() {
        return action;
    }

    public String getTarget() {
        return target;
    }

    public JsonNode getDetail() {
        return detail;
    }

    /** Replaces the name-bearing parts of an entry when its account is deleted (M26); nothing else ever changes. */
    void anonymize(String target, JsonNode detail) {
        this.target = target;
        this.detail = detail;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
