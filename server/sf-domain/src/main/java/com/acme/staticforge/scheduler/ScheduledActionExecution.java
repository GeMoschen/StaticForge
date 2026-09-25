package com.acme.staticforge.scheduler;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One execution of a {@link ScheduledAction} at one slot ({@code scheduledFor}, M27.4.1). Open while
 * {@code finishedAt} is {@code null}: an execution that waits for a busy project stays open between retries with its
 * progress in {@code detail}, and a node that re-claims the action after a lease expiry resumes it. {@code outcome}
 * of an open execution is what it ends with if it is abandoned now (a cancel while waiting).
 */
@Entity
@Table(name = "scheduled_action_execution")
public class ScheduledActionExecution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "action_id", nullable = false)
    private Long actionId;

    @Column(name = "scheduled_for", nullable = false)
    private Instant scheduledFor;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", length = 20)
    private ExecutionOutcome outcome;

    @Column(name = "late_by_ms", nullable = false)
    private long lateByMs;

    @Column(name = "message", length = 2000)
    private String message;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "detail")
    private JsonNode detail;

    @Column(name = "revision_id")
    private Long revisionId;

    @Column(name = "generation_run_id")
    private Long generationRunId;

    @Column(name = "executed_as_user_id")
    private Long executedAsUserId;

    protected ScheduledActionExecution() {}

    public ScheduledActionExecution(long actionId, Instant scheduledFor, Instant startedAt, long lateByMs, Long executedAsUserId) {
        this.actionId = actionId;
        this.scheduledFor = scheduledFor;
        this.startedAt = startedAt;
        this.lateByMs = lateByMs;
        this.executedAsUserId = executedAsUserId;
    }

    public boolean isOpen() {
        return finishedAt == null;
    }

    public Long getId() {
        return id;
    }

    public Long getActionId() {
        return actionId;
    }

    public Instant getScheduledFor() {
        return scheduledFor;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(Instant finishedAt) {
        this.finishedAt = finishedAt;
    }

    public ExecutionOutcome getOutcome() {
        return outcome;
    }

    public void setOutcome(ExecutionOutcome outcome) {
        this.outcome = outcome;
    }

    public long getLateByMs() {
        return lateByMs;
    }

    public void setLateByMs(long lateByMs) {
        this.lateByMs = lateByMs;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message == null || message.length() <= 2000 ? message : message.substring(0, 1997) + "…";
    }

    public JsonNode getDetail() {
        return detail;
    }

    public void setDetail(JsonNode detail) {
        this.detail = detail;
    }

    public Long getRevisionId() {
        return revisionId;
    }

    public void setRevisionId(Long revisionId) {
        this.revisionId = revisionId;
    }

    public Long getGenerationRunId() {
        return generationRunId;
    }

    public void setGenerationRunId(Long generationRunId) {
        this.generationRunId = generationRunId;
    }

    public Long getExecutedAsUserId() {
        return executedAsUserId;
    }

    public void setExecutedAsUserId(Long executedAsUserId) {
        this.executedAsUserId = executedAsUserId;
    }
}
