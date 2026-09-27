package com.acme.staticforge.housekeeping.search;

import com.acme.staticforge.housekeeping.JobProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Defaults of the {@code search-maintenance} job (M29.3.3, epic decisions 7 and 12):
 * {@code sf.housekeeping.search-maintenance.*}.
 */
@Component
@ConfigurationProperties(prefix = "sf.housekeeping.search-maintenance")
public class SearchMaintenanceProperties extends JobProperties {

    /** Deleted documents, as a percentage of all documents in the index, above which deletes are merged away. */
    private int mergeDeletesPct = 20;

    public SearchMaintenanceProperties() {
        super(true, "0 5 * * *");
    }

    public int getMergeDeletesPct() {
        return mergeDeletesPct;
    }

    public void setMergeDeletesPct(int mergeDeletesPct) {
        this.mergeDeletesPct = mergeDeletesPct;
    }
}
