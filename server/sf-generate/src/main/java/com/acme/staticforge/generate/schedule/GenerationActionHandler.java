package com.acme.staticforge.generate.schedule;

import com.acme.staticforge.scheduler.ScheduledGenerationStarter;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;

/** A one-off scheduled build: {@code GENERATION} at {@code runAt} (M27.4.3). */
@Component
public class GenerationActionHandler extends AbstractGenerationActionHandler {

    public static final String TYPE = "GENERATION";

    public GenerationActionHandler(ScheduledGenerationStarter generations, PlatformTransactionManager transactionManager) {
        super(generations, transactionManager);
    }

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Timing timing() {
        return Timing.ONE_OFF;
    }
}
