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

    /** Width of {@code search_text}. */
    public static final int SEARCH_TEXT_LENGTH = 4000;

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

    /**
     * Lower-cased item names (and uids) of the touched assets, one per line, truncated to the column: what the history
     * search ({@code q}) matches besides the comment. Written with the summary; revisions from before it was added
     * ({@code null}) match on their comment only.
     */
    @Column(name = "search_text", length = SEARCH_TEXT_LENGTH)
    private String searchText;

    /**
     * The revision's own changes were absorbed by revision compaction (M29.4.1, spec §7.7): some removed version
     * started at it. Written only by {@code RevisionCompactor} (JDBC); read-only here, a new row gets the column's
     * default {@code false}.
     */
    @Column(name = "compacted", nullable = false, insertable = false, updatable = false)
    private boolean compacted;

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

    public String getSearchText() {
        return searchText;
    }

    public void setSearchText(String searchText) {
        this.searchText = searchText;
    }

    public boolean isCompacted() {
        return compacted;
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
