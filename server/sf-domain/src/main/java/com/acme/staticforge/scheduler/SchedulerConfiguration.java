package com.acme.staticforge.scheduler;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.node.NodeIdentity;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The application's {@link SchedulerEngine} (M27.4.1): claims rows of {@code scheduled_action} as this node, and polls
 * once the application is ready when {@code sf.scheduler.enabled}. The engine stops with the context ({@code close}).
 * Every {@link SchedulerTickParticipant} bean joins the engine's poll (M29.1.1).
 * No {@code @EnableScheduling}: that would change how other beans behave.
 */
@Configuration
public class SchedulerConfiguration {

    /** A claim marks the action {@code RUNNING}: the API refuses to change it until the node lets go. */
    static final String CLAIMED = "status = 'RUNNING'";

    @Bean
    public SchedulerEngine schedulerEngine(
            ScheduledActionRepository actions,
            ScheduledActionExecutionRepository executions,
            ScheduledActionHandlers handlers,
            ActionAuthority authority,
            JdbcTemplate jdbc,
            AuditService audit,
            PlatformTransactionManager transactionManager,
            MeterRegistry meters,
            SchedulerProperties properties,
            NodeIdentity node,
            Clock clock) {
        return new SchedulerEngine(
                actions,
                executions,
                handlers,
                authority,
                scheduledActionClaimer(jdbc),
                audit,
                transactionManager,
                meters,
                properties,
                properties.effectiveNodeId(node),
                clock);
    }

    @Bean
    public ApplicationListener<ApplicationReadyEvent> schedulerStarter(
            SchedulerEngine engine,
            SchedulerProperties properties,
            ObjectProvider<SchedulerTickParticipant> participants) {
        return event -> {
            participants.orderedStream().forEach(engine::addTickParticipant);
            if (properties.isEnabled()) {
                engine.start();
            }
        };
    }

    /** The claimer of {@code scheduled_action} rows (also used by tests that run engines of their own). */
    public static LeaseClaimer scheduledActionClaimer(JdbcTemplate jdbc) {
        return new LeaseClaimer(jdbc, "scheduled_action", CLAIMED);
    }
}
