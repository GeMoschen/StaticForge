package com.acme.staticforge.generate.retention;

import com.acme.staticforge.housekeeping.JobProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** {@code sf.housekeeping.generation-run-retention.*} (M29.3.1): the defaults of {@link GenerationRunRetentionJob}. */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.generation-run-retention")
public class GenerationRunRetentionProperties extends JobProperties {

    /** Runs younger than this many days are kept (and so are the schedule executions' runs of that period). */
    private int keepDays = 90;

    /** The newest this many runs of each project are kept, whatever their age. */
    private int keepPerProject = 50;

    public GenerationRunRetentionProperties() {
        super(true, "15 4 * * *");
    }

    public int getKeepDays() {
        return keepDays;
    }

    public void setKeepDays(int keepDays) {
        this.keepDays = keepDays;
    }

    public int getKeepPerProject() {
        return keepPerProject;
    }

    public void setKeepPerProject(int keepPerProject) {
        this.keepPerProject = keepPerProject;
    }
}
