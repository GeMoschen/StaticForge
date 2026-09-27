package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.acme.staticforge.api.DevFixtureController;
import com.acme.staticforge.project.ProjectService;
import java.time.Clock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The journey fixture endpoint (M29.6.2) is registered only in the {@code dev} and {@code test} profiles: never in
 * {@code prod}, {@code demo} or without a profile (the default of a production start).
 */
class DevFixtureControllerProfileTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(ProjectService.class, () -> mock(ProjectService.class))
            .withBean(JdbcTemplate.class, () -> mock(JdbcTemplate.class))
            .withBean(Clock.class, Clock::systemUTC)
            .withUserConfiguration(DevFixtureController.class);

    @ParameterizedTest(name = "absent with profiles [{0}]")
    @ValueSource(strings = {"", "prod", "demo", "default"})
    @DisplayName("absent outside dev and test")
    void absent(String profiles) {
        runner.withPropertyValues("spring.profiles.active=" + profiles)
                .run(context -> assertThat(context).doesNotHaveBean(DevFixtureController.class));
    }

    @ParameterizedTest(name = "present with profiles [{0}]")
    @ValueSource(strings = {"dev", "test"})
    @DisplayName("present in dev and test")
    void present(String profiles) {
        runner.withPropertyValues("spring.profiles.active=" + profiles)
                .run(context -> assertThat(context).hasSingleBean(DevFixtureController.class));
    }
}
