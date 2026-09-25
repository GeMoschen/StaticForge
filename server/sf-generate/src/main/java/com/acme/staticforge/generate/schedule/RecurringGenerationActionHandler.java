package com.acme.staticforge.generate.schedule;

import com.acme.staticforge.scheduler.ScheduledGenerationStarter;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * A recurring build: {@code RECURRING_GENERATION} on a cron in the creator's time zone (M27.4.3, spec §18.1
 * "Scheduled | full, cron per project"). Each slot starts one run.
 */
@Component
public class RecurringGenerationActionHandler extends AbstractGenerationActionHandler {

    public static final String TYPE = "RECURRING_GENERATION";

    public RecurringGenerationActionHandler(
            ScheduledGenerationStarter generations, PlatformTransactionManager transactionManager) {
        super(generations, transactionManager);
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Timing timing() {
        return Timing.RECURRING;
    }
}
