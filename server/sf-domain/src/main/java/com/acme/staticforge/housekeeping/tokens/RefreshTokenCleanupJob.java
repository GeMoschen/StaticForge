package com.acme.staticforge.housekeeping.tokens;

import com.acme.staticforge.housekeeping.HousekeepingJob;
import com.acme.staticforge.housekeeping.JobContext;
import com.acme.staticforge.housekeeping.JobDefaults;
import com.acme.staticforge.housekeeping.JobResult;
import com.acme.staticforge.housekeeping.SettingsSpec;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Job {@code refresh-token-cleanup} (M29.2.4, epic decision 7, finding 7): deletes dead refresh-token families, always
 * whole. Revoked rows of a live family are what reuse detection matches a presented stolen token against
 * ({@code RefreshTokenService.rotate}), so a family goes only when
 *
 * <ul>
 *   <li>it is past its absolute expiry (every row's {@code absolute_expires_at} &lt; now), or
 *   <li>every row is revoked or expired and the newest row's {@code expires_at} is older than {@code reuseWindow}
 *       (default 7 days), so a token presented shortly after expiry is still recognized.
 * </ul>
 *
 * A single row of a family that still has a usable token is never deleted. Each batch deletes up to
 * {@value #BATCH} families in its own transaction and re-checks the rule in the delete.
 */
@Component
public class RefreshTokenCleanupJob implements HousekeepingJob {

    public static final String KEY = "refresh-token-cleanup";

    static final int BATCH = 500;

    static final SettingsSpec SETTINGS = SettingsSpec.builder()
            .duration("reuseWindow", Duration.ZERO, Duration.ofDays(365))
            .build();

    /** The dead-family rule; parameters: now, now, now − reuseWindow. */
    private static final String DEAD_FAMILIES = "SELECT family_id FROM refresh_token GROUP BY family_id"
            + " HAVING MAX(absolute_expires_at) < ?"
            + " OR (SUM(CASE WHEN revoked OR expires_at < ? THEN 0 ELSE 1 END) = 0 AND MAX(expires_at) < ?)";

    private final RefreshTokenCleanupProperties properties;
    private final JdbcTemplate jdbc;

    public RefreshTokenCleanupJob(RefreshTokenCleanupProperties properties, JdbcTemplate jdbc) {
        this.properties = properties;
        this.jdbc = jdbc;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public String displayName() {
        return "Refresh-token cleanup";
    }

    @Override
    public String description() {
        return "Deletes refresh-token families past their absolute expiry or expired for longer than the reuse window.";
    }

    @Override
    public JobDefaults defaults() {
        return JobDefaults.of(properties, settings -> settings.put("reuseWindow", properties.getReuseWindow().toString()));
    }

    @Override
    public List<String> validateSettings(JsonNode settings) {
        return SETTINGS.validate(settings);
    }

    @Override
    public JobResult run(JobContext ctx) {
        Duration reuseWindow = ctx.settings().duration("reuseWindow");
        OffsetDateTime now = utc(ctx.now());
        OffsetDateTime windowCutoff = utc(ctx.now().minus(reuseWindow));
        Long families = jdbc.queryForObject("SELECT COUNT(DISTINCT family_id) FROM refresh_token", Long.class);
        ctx.examined(families == null ? 0 : families);

        long familiesDeleted = 0;
        long rowsDeleted = 0;
        while (true) {
            ctx.checkCancelled();
            List<String> dead = jdbc.queryForList(DEAD_FAMILIES + " ORDER BY family_id LIMIT " + BATCH, String.class,
                    now, now, windowCutoff);
            if (dead.isEmpty()) {
                break;
            }
            int rows = ctx.inTransaction(() -> deleteFamilies(dead, now, windowCutoff));
            if (rows == 0) {
                break; // every candidate came back to life (rotated) in between: nothing more to do this run
            }
            familiesDeleted += dead.size();
            rowsDeleted += rows;
            ctx.affected(dead.size());
            dead.forEach(ctx::sample);
            if (dead.size() < BATCH) {
                break;
            }
        }
        ctx.report().put("familiesDeleted", familiesDeleted).put("rowsDeleted", rowsDeleted)
                .put("reuseWindow", reuseWindow.toString());
        return JobResult.succeeded("Deleted " + familiesDeleted + " refresh-token families (" + rowsDeleted + " rows).");
    }

    /** Deletes the rows of {@code families} that are still dead by the rule; the number of rows deleted. */
    private int deleteFamilies(List<String> families, OffsetDateTime now, OffsetDateTime windowCutoff) {
        String placeholders = String.join(",", Collections.nCopies(families.size(), "?"));
        Object[] args = new Object[families.size() + 3];
        for (int i = 0; i < families.size(); i++) {
            args[i] = families.get(i);
        }
        args[families.size()] = now;
        args[families.size() + 1] = now;
        args[families.size() + 2] = windowCutoff;
        return jdbc.update("DELETE FROM refresh_token WHERE family_id IN (" + placeholders + ") AND family_id IN ("
                + DEAD_FAMILIES + ")", args);
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
