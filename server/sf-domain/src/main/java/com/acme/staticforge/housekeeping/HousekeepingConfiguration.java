package com.acme.staticforge.housekeeping;

import com.acme.staticforge.scheduler.SchedulerProperties;
import com.acme.staticforge.scheduler.SchedulerTickParticipant;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The application's {@link SystemJobRunner} (M29.1.1): every {@link HousekeepingJob} bean, run as this node (the
 * scheduler's node id and lease). Once the application is ready the missing job rows are seeded and, when
 * {@code sf.housekeeping.enabled}, the startup jobs run; the runner joins the scheduler engine's poll as a
 * {@link SchedulerTickParticipant}, so jobs run on the same tick as scheduled actions and only where the engine polls.
 */
@Configuration
public class HousekeepingConfiguration {

    private static final Logger log = LoggerFactory.getLogger(HousekeepingConfiguration.class);

    @Bean
    public SystemJobRunner systemJobRunner(
            ObjectProvider<HousekeepingJob> jobs,
            SystemJobRepository jobRows,
            SystemJobRunRepository runs,
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            MeterRegistry meters,
            HousekeepingProperties properties,
            SchedulerProperties scheduler,
            Clock clock) {
        return new SystemJobRunner(
                jobs.orderedStream().toList(),
                jobRows,
                runs,
                jdbc,
                transactionManager,
                meters,
                properties,
                scheduler.getLease(),
                scheduler.effectiveNodeId(),
                clock);
    }

    /** The runner's part of the scheduler poll. */
    @Bean
    public SchedulerTickParticipant systemJobTick(SystemJobRunner runner, HousekeepingProperties properties) {
        return () -> {
            if (properties.isEnabled()) {
                runner.tick();
            }
        };
    }

    @Bean
    public ApplicationListener<ApplicationReadyEvent> systemJobStarter(
            SystemJobRunner runner, HousekeepingProperties properties) {
        return event -> {
            try {
                runner.seed();
            } catch (RuntimeException e) {
                log.error("Could not seed the system jobs", e);
                return;
            }
            if (properties.isEnabled()) {
                runner.runStartupJobs();
            }
        };
    }
}
