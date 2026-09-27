package com.acme.staticforge.housekeeping.blobs;

import com.acme.staticforge.housekeeping.JobProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Defaults of the {@code blob-sweep} job (M29.2.3, epic decision 7): {@code sf.housekeeping.blob-sweep.*}. */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.blob-sweep")
public class BlobSweepProperties extends JobProperties {

    /**
     * How many hours a blob is kept after it was created or last referenced by a write (and store bytes without a row
     * after their last modification), whatever the mark says. Protects in-flight uploads. At least 1.
     */
    private int graceHours = 24;

    /** Rows per page (mark and sweep), each read or updated in its own short transaction. */
    private int batchSize = 1000;

    public BlobSweepProperties() {
        super(true, "30 3 * * *");
    }

    public int getGraceHours() {
        return graceHours;
    }

    public void setGraceHours(int graceHours) {
        this.graceHours = graceHours;
    }

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }
}
