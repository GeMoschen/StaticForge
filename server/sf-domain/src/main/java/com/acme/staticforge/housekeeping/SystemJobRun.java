package com.acme.staticforge.housekeeping;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One run of a system job (M29.1.1, epic decision 2). Written when the run starts ({@code finishedAt} and
 * {@code outcome} {@code null}, {@code message} the latest progress line) and completed when it ends. {@code report}
 * holds a bounded {@code sample} (at most {@value JobContext#MAX_SAMPLE} items, {@code sampleTotal} counts all), the
 * job's own structured data and, for a failure, an {@code error} digest.
 */
@Entity
@Table(name = "system_job_run")
public class SystemJobRun {

    /** The longest {@code message} the column holds. */
    public static final int MAX_MESSAGE = 2000;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_key", nullable = false, length = 64, updatable = false)
    private String jobKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "trigger", nullable = false, length = 20, updatable = false)
    private JobTrigger trigger;

    @Column(name = "dry_run", nullable = false, updatable = false)
    private boolean dryRun;

    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", length = 20)
    private JobOutcome outcome;

    @Column(name = "items_examined", nullable = false)
    private long itemsExamined;

    @Column(name = "items_affected", nullable = false)
    private long itemsAffected;

    @Column(name = "bytes_freed", nullable = false)
    private long bytesFreed;

    @Column(name = "message", length = MAX_MESSAGE)
    private String message;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "report")
    private JsonNode report;

    @Column(name = "started_by", updatable = false)
    private Long startedBy;

    protected SystemJobRun() {}

    public SystemJobRun(String jobKey, JobTrigger trigger, boolean dryRun, Instant startedAt, Long startedBy) {
        this.jobKey = jobKey;
        this.trigger = trigger;
        this.dryRun = dryRun;
        this.startedAt = startedAt;
        this.startedBy = startedBy;
    }

    public Long getId() {
        return id;
    }

    public String getJobKey() {
        return jobKey;
    }

    public JobTrigger getTrigger() {
        return trigger;
    }

    public boolean isDryRun() {
        return dryRun;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public boolean isFinished() {
        return finishedAt != null;
    }

    /** From start to finish; {@code null} while the run is going. */
    public Duration getDuration() {
        return finishedAt == null ? null : Duration.between(startedAt, finishedAt);
    }

    public JobOutcome getOutcome() {
        return outcome;
    }

    public long getItemsExamined() {
        return itemsExamined;
    }

    public long getItemsAffected() {
        return itemsAffected;
    }

    public long getBytesFreed() {
        return bytesFreed;
    }

    public String getMessage() {
        return message;
    }

    /** A copy of the report ({@code null} until the run ended). */
    public JsonNode getReport() {
        return report == null ? null : report.deepCopy();
    }

    public Long getStartedBy() {
        return startedBy;
    }

    /** Completes the run. */
    public void finish(
            Instant finishedAt,
            JobOutcome outcome,
            String message,
            long examined,
            long affected,
            long bytesFreed,
            JsonNode report) {
        this.finishedAt = finishedAt;
        this.outcome = outcome;
        this.message = truncate(message);
        this.itemsExamined = examined;
        this.itemsAffected = affected;
        this.bytesFreed = bytesFreed;
        this.report = report == null ? null : report.deepCopy();
    }

    /** {@code message} cut to what the column holds. */
    public static String truncate(String message) {
        if (message == null || message.length() <= MAX_MESSAGE) {
            return message;
        }
        return message.substring(0, MAX_MESSAGE - 1) + "…";
    }
}
