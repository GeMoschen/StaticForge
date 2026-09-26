package com.acme.staticforge.generate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.publish.PublishPermission;
import com.acme.staticforge.project.publish.PublishRequirements;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** What a generation request needs (M28.2.2, epic decision 7). */
class GenerationAuthorizationTest {

    private static final long PROJECT = 7L;
    private static final PublishRequirements INCREMENTAL = PublishRequirements.permission(PublishPermission.INCREMENTAL_BUILD);
    private static final PublishRequirements FULL = PublishRequirements.permission(PublishPermission.FULL_BUILD);
    private static final PublishRequirements DEVELOPER = PublishRequirements.role(ProjectRole.DEVELOPER);

    private final GenerationTargetRepository targets = mock(GenerationTargetRepository.class);
    private final GenerationAuthorization authorization = new GenerationAuthorization(targets);

    @Test
    @DisplayName("mode, target and revision decide: incremental to the default, full for anything else, developer for a pin")
    void rule() {
        GenerationTarget primary = target(10L);
        when(targets.findByProjectIdAndDefaultTargetTrue(PROJECT)).thenReturn(Optional.of(primary));

        assertThat(authorization.requiredFor(PROJECT, null, null, null)).as("a missing mode is FULL").isEqualTo(FULL);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.FULL, null, null)).isEqualTo(FULL);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, null, null)).isEqualTo(INCREMENTAL);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, 10L, null)).isEqualTo(INCREMENTAL);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, 11L, null)).isEqualTo(FULL);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, null, 3L)).isEqualTo(DEVELOPER);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.FULL, 11L, 3L)).isEqualTo(DEVELOPER);
    }

    @Test
    @DisplayName("without a default target, the first target is where a run without one goes")
    void firstTargetStandsInForTheDefault() {
        when(targets.findByProjectIdAndDefaultTargetTrue(PROJECT)).thenReturn(Optional.empty());
        List<GenerationTarget> both = List.of(target(20L), target(21L));
        when(targets.findByProjectId(PROJECT)).thenReturn(both);

        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, 20L, null)).isEqualTo(INCREMENTAL);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, 21L, null)).isEqualTo(FULL);
    }

    @Test
    @DisplayName("a project without targets: only an absent target id is incremental (the start then fails with 422)")
    void noTargets() {
        when(targets.findByProjectIdAndDefaultTargetTrue(PROJECT)).thenReturn(Optional.empty());
        when(targets.findByProjectId(PROJECT)).thenReturn(List.of());

        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, null, null)).isEqualTo(INCREMENTAL);
        assertThat(authorization.requiredFor(PROJECT, GenerationMode.INCREMENTAL, 5L, null)).isEqualTo(FULL);
    }

    private static GenerationTarget target(long id) {
        GenerationTarget target = mock(GenerationTarget.class);
        when(target.getId()).thenReturn(id);
        return target;
    }
}
