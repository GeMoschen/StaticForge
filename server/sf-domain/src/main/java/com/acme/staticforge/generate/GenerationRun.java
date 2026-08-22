package com.acme.staticforge.generate;

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
 * A single static-site generation run (spec §18.5). {@code revisionId} pins the snapshot
 * revision; {@code null} means "current". {@code mode} and {@code status} are stored as
 * the plain enum names (mirroring {@code Revision.changeType}), not {@code @Enumerated}.
 */
@Entity
@Table(name = "generation_run")
public class GenerationRun {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private long projectId;

    @Column(name = "revision_id")
    private Long revisionId;

    @Column(name = "mode", nullable = false, length = 20)
    private String mode;

    @Column(name = "channels", length = 500)
    private String channels;

    @Column(name = "target_id")
    private Long targetId;

    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "started_by")
    private Long startedBy;

    @Column(name = "files_written", nullable = false)
    private long filesWritten;

    @Column(name = "files_skipped", nullable = false)
    private long filesSkipped;

    @Column(name = "bytes_written", nullable = false)
    private long bytesWritten;

    @Column(name = "error_count", nullable = false)
    private int errorCount;

    @Column(name = "warning_count", nullable = false)
    private int warningCount;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "diagnostics")
    private JsonNode diagnostics;

    @Column(name = "log_blob_sha", length = 64)
    private String logBlobSha;

    protected GenerationRun() {}

    public GenerationRun(long projectId, Long revisionId, GenerationMode mode, String channels, Long targetId,
            RunStatus status, Instant startedAt, Instant finishedAt, Long startedBy, long filesWritten,
            long filesSkipped, long bytesWritten, int errorCount, int warningCount, JsonNode diagnostics,
            String logBlobSha) {
        this.projectId = projectId;
        this.revisionId = revisionId;
        this.mode = mode.name();
        this.channels = channels;
        this.targetId = targetId;
        this.status = status.name();
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
        this.startedBy = startedBy;
        this.filesWritten = filesWritten;
        this.filesSkipped = filesSkipped;
        this.bytesWritten = bytesWritten;
        this.errorCount = errorCount;
        this.warningCount = warningCount;
        this.diagnostics = diagnostics;
        this.logBlobSha = logBlobSha;
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

    public Long getRevisionId() {
        return revisionId;
    }

    public void setRevisionId(Long revisionId) {
        this.revisionId = revisionId;
    }

    public GenerationMode getMode() {
        return GenerationMode.valueOf(mode);
    }

    public void setMode(GenerationMode mode) {
        this.mode = mode.name();
    }

    public String getChannels() {
        return channels;
    }

    public void setChannels(String channels) {
        this.channels = channels;
    }

    public Long getTargetId() {
        return targetId;
    }

    public void setTargetId(Long targetId) {
        this.targetId = targetId;
    }

    public RunStatus getStatus() {
        return RunStatus.valueOf(status);
    }

    public void setStatus(RunStatus status) {
        this.status = status.name();
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    public Long getStartedBy() {
        return startedBy;
    }

    public void setStartedBy(Long startedBy) {
        this.startedBy = startedBy;
    }

    public long getFilesWritten() {
        return filesWritten;
    }

    public void setFilesWritten(long filesWritten) {
        this.filesWritten = filesWritten;
    }

    public long getFilesSkipped() {
        return filesSkipped;
    }

    public void setFilesSkipped(long filesSkipped) {
        this.filesSkipped = filesSkipped;
    }

    public long getBytesWritten() {
        return bytesWritten;
    }

    public void setBytesWritten(long bytesWritten) {
        this.bytesWritten = bytesWritten;
    }

    public int getErrorCount() {
        return errorCount;
    }

    public void setErrorCount(int errorCount) {
        this.errorCount = errorCount;
    }

    public int getWarningCount() {
        return warningCount;
    }

    public void setWarningCount(int warningCount) {
        this.warningCount = warningCount;
    }

    public JsonNode getDiagnostics() {
        return diagnostics;
    }

    public void setDiagnostics(JsonNode diagnostics) {
        this.diagnostics = diagnostics;
    }

    public String getLogBlobSha() {
        return logBlobSha;
    }

    public void setLogBlobSha(String logBlobSha) {
        this.logBlobSha = logBlobSha;
    }
}
