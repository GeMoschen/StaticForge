package com.acme.staticforge.api;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Test fixtures for end-to-end journeys (M29.6.2) that need data the public API can't produce, such as history older
 * than a month for revision compaction. Exists <b>only</b> in the {@code dev} and {@code test} profiles (never in
 * {@code prod} or without a profile; {@code DevFixtureControllerProfileTest} proves it) and only for instance admins.
 * It is not part of the OpenAPI document, which is generated without a profile.
 */
@RestController
@Profile({"dev", "test"})
@RequestMapping("/api/v1/dev/fixtures")
@PreAuthorize("hasAuthority('SYS_INSTANCE_ADMIN')")
public class DevFixtureController {

    /** Upper bound of {@link BackdateRequest#days()}: ten years is far beyond every retention in the system. */
    static final int MAX_DAYS = 3650;

    private final ProjectService projects;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public DevFixtureController(ProjectService projects, JdbcTemplate jdbc, Clock clock) {
        this.projects = projects;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /**
     * Moves the project's revisions {@code 1..throughRevision} onto one UTC day {@code days} ago: revision
     * {@code r} gets that day at 01:00 UTC plus {@code r} seconds, so their order is kept and they share a day (the
     * unit revision compaction groups by). Only {@code revision.created_at} changes; versions, references and releases
     * are untouched.
     */
    @PostMapping("/projects/{projectKey}/backdate-revisions")
    @Transactional
    public BackdateResult backdateRevisions(@PathVariable String projectKey, @RequestBody BackdateRequest body) {
        if (body.days() < 1 || body.days() > MAX_DAYS) {
            throw new SfException(ProblemFactory.unprocessableEntity("days must be between 1 and " + MAX_DAYS + "."));
        }
        if (body.throughRevision() < 1) {
            throw new SfException(ProblemFactory.unprocessableEntity("throughRevision must be at least 1."));
        }
        Project project = projects.requireByKey(projectKey);
        Instant day = Instant.now(clock).truncatedTo(ChronoUnit.DAYS).minus(body.days(), ChronoUnit.DAYS)
                .plus(1, ChronoUnit.HOURS);
        List<Long> revisions = jdbc.queryForList(
                "SELECT revision_id FROM revision WHERE project_id = ? AND revision_id <= ? ORDER BY revision_id",
                Long.class, project.getId(), body.throughRevision());
        jdbc.batchUpdate(
                "UPDATE revision SET created_at = ? WHERE project_id = ? AND revision_id = ?",
                revisions,
                500,
                (ps, revision) -> {
                    ps.setObject(1, OffsetDateTime.ofInstant(day.plusSeconds(revision), ZoneOffset.UTC));
                    ps.setLong(2, project.getId());
                    ps.setLong(3, revision);
                });
        return new BackdateResult(projectKey, revisions.size(), day);
    }

    public record BackdateRequest(int days, long throughRevision) {}

    public record BackdateResult(String projectKey, int revisionsShifted, Instant day) {}
}
