package com.acme.staticforge.bootstrap;

import com.acme.staticforge.asset.reference.ReferenceBackfill;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Rebuilds {@code asset_reference} from the version history at startup when the table is empty
 * but asset versions exist — the state Liquibase changeset {@code 015-references-drop-generation-rows}
 * leaves behind (M16.3.3). A database whose assets genuinely have no references is re-scanned on
 * each startup, which is harmless. Disable with {@code sf.references.backfill-on-startup=false}.
 */
@Component
public class ReferenceBackfillRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ReferenceBackfillRunner.class);

    private final ReferenceBackfill backfill;
    private final boolean enabled;

    public ReferenceBackfillRunner(
            ReferenceBackfill backfill, @Value("${sf.references.backfill-on-startup:true}") boolean enabled) {
        this.backfill = backfill;
        this.enabled = enabled;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled || !backfill.isNeeded()) {
            return;
        }
        int assets = backfill.rebuildAll();
        log.info("Rebuilt asset_reference from the version history of {} assets", assets);
    }
}
