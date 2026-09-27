package com.acme.staticforge.revision.compaction;

import com.acme.staticforge.housekeeping.JobProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * {@code sf.housekeeping.revision-compaction.*} (M29.4.2): the defaults of the {@code revision-compaction} job. The job
 * is enabled but only acts on projects that opted in ({@code PUT /projects/{key}/compaction}); how old history must be
 * is each project's own {@code olderThanDays}, not a job setting.
 */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.revision-compaction")
public class RevisionCompactionProperties extends JobProperties {

    /**
     * Assets per batch. A batch is one transaction holding the project's revision lock, so saves of that project wait
     * for it: keep it small (milliseconds per batch). From 1 to 10 000.
     */
    private int batchAssets = RevisionCompactor.DEFAULT_BATCH_ASSETS;

    public RevisionCompactionProperties() {
        super(true, "0 3 * * 0");
    }

    public int getBatchAssets() {
        return batchAssets;
    }

    public void setBatchAssets(int batchAssets) {
        this.batchAssets = batchAssets;
    }
}
