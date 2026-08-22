package com.acme.staticforge.revision;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A single project-scoped revision (spec §7.2). The composite key is
 * {@code (projectId, revisionId)} where {@code revisionId} is gapless and monotonic per
 * project.
 */
@Entity
@Table(name = "revision")
@IdClass(Revision.RevisionId.class)
public class Revision {

    @Id
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Id
    @Column(name = "revision_id", nullable = false)
    private Long revisionId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "change_type", nullable = false, length = 30)
    private String changeType;

    @Column(name = "comment", length = 500)
    private String comment;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "summary", nullable = false)
    private JsonNode summary;

    protected Revision() {}

    public Revision(Long projectId, Long revisionId, Instant createdAt, Long createdBy, ChangeType changeType,
            String comment, JsonNode summary) {
        this.projectId = projectId;
        this.revisionId = revisionId;
        this.createdAt = createdAt;
        this.createdBy = createdBy;
        this.changeType = changeType.name();
        this.comment = comment;
        this.summary = summary;
    }

    public Long getProjectId() {
        return projectId;
    }

    public Long getRevisionId() {
        return revisionId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public ChangeType getChangeType() {
        return ChangeType.valueOf(changeType);
    }

    public String getComment() {
        return comment;
    }

    public JsonNode getSummary() {
        return summary;
    }

    public void setSummary(JsonNode summary) {
        this.summary = summary;
    }

    public static class RevisionId implements Serializable {
        private Long projectId;
        private Long revisionId;

        public RevisionId() {}

        public RevisionId(Long projectId, Long revisionId) {
            this.projectId = projectId;
            this.revisionId = revisionId;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof RevisionId that)) return false;
            return Objects.equals(projectId, that.projectId) && Objects.equals(revisionId, that.revisionId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(projectId, revisionId);
        }
    }
}
