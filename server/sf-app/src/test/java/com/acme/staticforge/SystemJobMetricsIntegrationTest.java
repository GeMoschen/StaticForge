package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.housekeeping.NoopJob;
import com.acme.staticforge.housekeeping.SystemJobRun;
import com.acme.staticforge.housekeeping.SystemJobRunRepository;
import com.acme.staticforge.housekeeping.SystemJobService;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The {@code sf.job.*} metrics of epic decision 6 on {@code /actuator/prometheus} (M29.1.1). Needs
 * {@link AutoConfigureObservability}: tests otherwise export no metrics.
 */
@SpringBootTest
@AutoConfigureMockMvc
@AutoConfigureObservability
@ActiveProfiles("test")
class SystemJobMetricsIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired SystemJobService jobs;
    @Autowired SystemJobRunRepository runs;

    @Test
    @DisplayName("a finished run shows duration, items, bytes freed and the last-success age on /actuator/prometheus")
    void metricsOnPrometheus() throws Exception {
        String before = scrape();
        assertThat(before).contains("sf_job_last_success_age_seconds{job=\"test-noop\"} NaN");

        SystemJobRun run = jobs.runNow(NoopJob.KEY, false, null);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
        while (!runs.findById(run.getId()).orElseThrow().isFinished()) {
            assertThat(System.nanoTime()).as("run finished in time").isLessThan(deadline);
            Thread.sleep(20);
        }
        String body = "";
        while (System.nanoTime() < deadline && !body.contains("sf_job_duration_seconds_count{job=\"test-noop\"")) {
            body = scrape(); // the timer is recorded right after the run row is completed
            Thread.sleep(20);
        }

        assertThat(body)
                .containsPattern("sf_job_duration_seconds_count\\{job=\"test-noop\",outcome=\"SUCCEEDED\"} 1(\\.0)?\\n")
                .containsPattern("sf_job_items_total\\{job=\"test-noop\",kind=\"examined\"} 3(\\.0)?\\n")
                .containsPattern("sf_job_items_total\\{job=\"test-noop\",kind=\"affected\"} 2(\\.0)?\\n")
                .containsPattern("sf_job_bytes_freed_total\\{job=\"test-noop\"} 2048(\\.0)?\\n")
                .containsPattern("sf_job_last_success_age_seconds\\{job=\"test-noop\"} \\d+(\\.\\d+)?(E-?\\d+)?\\n");
    }

    private String scrape() throws Exception {
        return mvc.perform(get("/actuator/prometheus"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
    }
}
