package com.acme.staticforge.generate.cleanup;

import com.acme.staticforge.housekeeping.JobProperties;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** {@code sf.housekeeping.build-output-cleanup.*} (M29.2.2): the defaults of {@link BuildOutputCleanupJob}. */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.build-output-cleanup")
public class BuildOutputCleanupProperties extends JobProperties {

    /**
     * How old output without a run row, a temporary {@code .current-*} link or a deleted target's directory must be
     * before it is removed, so nothing that is being written right now is touched.
     */
    private Duration minAge = Duration.ofHours(1);

    public BuildOutputCleanupProperties() {
        super(true, "10 3 * * *");
    }

    public Duration getMinAge() {
        return minAge;
    }

    public void setMinAge(Duration minAge) {
        this.minAge = minAge;
    }
}
