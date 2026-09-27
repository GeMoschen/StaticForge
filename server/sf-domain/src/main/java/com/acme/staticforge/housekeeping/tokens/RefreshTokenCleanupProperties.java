package com.acme.staticforge.housekeeping.tokens;

import com.acme.staticforge.housekeeping.JobProperties;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Defaults of the {@code refresh-token-cleanup} job (M29.2.4, epic decision 7):
 * {@code sf.housekeeping.refresh-token-cleanup.*}.
 */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.refresh-token-cleanup")
public class RefreshTokenCleanupProperties extends JobProperties {

    /**
     * How long a family whose every token is revoked or expired is kept after its newest token expired, so that a
     * stolen token presented shortly after expiry is still recognized as reuse.
     */
    private Duration reuseWindow = Duration.ofDays(7);

    public RefreshTokenCleanupProperties() {
        super(true, "15 * * * *");
    }

    public Duration getReuseWindow() {
        return reuseWindow;
    }

    public void setReuseWindow(Duration reuseWindow) {
        this.reuseWindow = reuseWindow;
    }
}
