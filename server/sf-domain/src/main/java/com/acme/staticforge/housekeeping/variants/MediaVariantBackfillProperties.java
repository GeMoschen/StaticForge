package com.acme.staticforge.housekeeping.variants;

import com.acme.staticforge.housekeeping.JobProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Defaults of the {@code media-variant-backfill} job (M29.3.2, epic decision 7):
 * {@code sf.housekeeping.media-variant-backfill.*}.
 */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.media-variant-backfill")
public class MediaVariantBackfillProperties extends JobProperties {

    /** The most variants one run tries to create (successes and failures); the rest waits for the next run. */
    private int maxPerRun = 500;

    /** Whether closed (historical) versions get missing variants too, so rebuilding old revisions has them. */
    private boolean includeHistorical = false;

    public MediaVariantBackfillProperties() {
        super(true, "0 2 * * *");
    }

    public int getMaxPerRun() {
        return maxPerRun;
    }

    public void setMaxPerRun(int maxPerRun) {
        this.maxPerRun = maxPerRun;
    }

    public boolean isIncludeHistorical() {
        return includeHistorical;
    }

    public void setIncludeHistorical(boolean includeHistorical) {
        this.includeHistorical = includeHistorical;
    }
}
