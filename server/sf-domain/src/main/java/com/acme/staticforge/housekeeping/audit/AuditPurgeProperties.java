package com.acme.staticforge.housekeeping.audit;

import com.acme.staticforge.housekeeping.JobProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Defaults of the {@code audit-purge} job (M29.2.4, epic decision 7): {@code sf.housekeeping.audit-purge.*}. */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.audit-purge")
public class AuditPurgeProperties extends JobProperties {

    /** How many days audit entries are kept (spec §26.3: one year). At least 30 days. */
    private int retentionDays = 365;

    /** How many entries one delete batch (one short transaction) removes at most. */
    private int batchSize = 5000;

    public AuditPurgeProperties() {
        super(true, "0 4 * * *");
    }

    public int getRetentionDays() {
        return retentionDays;
    }

    public void setRetentionDays(int retentionDays) {
        this.retentionDays = retentionDays;
    }

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }
}
