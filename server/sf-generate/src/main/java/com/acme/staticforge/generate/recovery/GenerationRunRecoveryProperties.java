package com.acme.staticforge.generate.recovery;

import com.acme.staticforge.housekeeping.JobProperties;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** {@code sf.housekeeping.generation-run-recovery.*} (M29.2.1): the defaults of {@link GenerationRunRecoveryJob}. */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.generation-run-recovery")
public class GenerationRunRecoveryProperties extends JobProperties {

    /**
     * How old a run's heartbeat (a queued run's queue time) may get before any node fails it as interrupted. Well above
     * {@code sf.generate.heartbeat-interval}; at least one minute.
     */
    private Duration staleAfter = Duration.ofMinutes(5);

    public GenerationRunRecoveryProperties() {
        super(true, "*/5 * * * *");
    }

    public Duration getStaleAfter() {
        return staleAfter;
    }

    public void setStaleAfter(Duration staleAfter) {
        this.staleAfter = staleAfter;
    }
}
