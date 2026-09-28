package com.acme.staticforge.generate.quality;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Typed binding for {@code sf.quality.*} (M30.1.2, epic decision 9): the storage caps of a run's findings. */
@Component
@ConfigurationProperties(prefix = "sf.quality")
public class QualityProperties {

    /** At most this many findings of one rule are stored per output; the rest are counted as truncated. */
    private int maxFindingsPerOutput = 50;

    /** At most this many findings are stored per run; the rest are counted as truncated. */
    private int maxFindingsPerRun = 100_000;

    public int getMaxFindingsPerOutput() {
        return maxFindingsPerOutput;
    }

    public void setMaxFindingsPerOutput(int maxFindingsPerOutput) {
        this.maxFindingsPerOutput = maxFindingsPerOutput;
    }

    public int getMaxFindingsPerRun() {
        return maxFindingsPerRun;
    }

    public void setMaxFindingsPerRun(int maxFindingsPerRun) {
        this.maxFindingsPerRun = maxFindingsPerRun;
    }
}
