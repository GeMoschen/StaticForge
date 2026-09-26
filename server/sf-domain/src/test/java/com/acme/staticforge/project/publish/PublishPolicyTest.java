package com.acme.staticforge.project.publish;

import static com.acme.staticforge.project.publish.PublishPermission.FULL_BUILD;
import static com.acme.staticforge.project.publish.PublishPermission.INCREMENTAL_BUILD;
import static com.acme.staticforge.project.publish.PublishPermission.RELEASE;
import static com.acme.staticforge.project.publish.PublishPermission.SCHEDULE_RELEASE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.project.ProjectRole;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The single publish rule (M28.1.1, epic decisions 1–3, 6). */
class PublishPolicyTest {

    /** Every subset of the four permissions, valid or not: {@code grants} doesn't depend on validity. */
    static List<Set<PublishPermission>> subsets() {
        List<Set<PublishPermission>> all = new ArrayList<>();
        PublishPermission[] values = PublishPermission.values();
        for (int mask = 0; mask < 1 << values.length; mask++) {
            EnumSet<PublishPermission> subset = EnumSet.noneOf(PublishPermission.class);
            for (int i = 0; i < values.length; i++) {
                if ((mask & 1 << i) != 0) {
                    subset.add(values[i]);
                }
            }
            all.add(subset);
        }
        return all;
    }

    @Test
    @DisplayName("grants: viewers never, editors exactly the policy, developers and admins always — every subset")
    void grantsTable() {
        assertThat(subsets()).hasSize(16);
        for (Set<PublishPermission> subset : subsets()) {
            PublishPolicy policy = new PublishPolicy(subset);
            for (PublishPermission permission : PublishPermission.values()) {
                assertThat(policy.grants(ProjectRole.VIEWER, permission)).as("viewer %s %s", subset, permission).isFalse();
                assertThat(policy.grants(ProjectRole.EDITOR, permission))
                        .as("editor %s %s", subset, permission)
                        .isEqualTo(subset.contains(permission));
                assertThat(policy.grants(ProjectRole.DEVELOPER, permission)).as("developer %s", subset).isTrue();
                assertThat(policy.grants(ProjectRole.PROJECT_ADMIN, permission)).as("admin %s", subset).isTrue();
            }
            assertThat(policy.effective(ProjectRole.EDITOR)).isEqualTo(subset);
            assertThat(policy.effective(ProjectRole.VIEWER)).isEmpty();
            assertThat(policy.effective(ProjectRole.DEVELOPER)).containsExactly(PublishPermission.values());
        }
    }

    @Test
    @DisplayName("validate: one message per broken implication, none for a valid policy")
    void validate() {
        assertThat(PublishPolicy.EMPTY.validate()).isEmpty();
        assertThat(PublishPolicy.of(RELEASE, SCHEDULE_RELEASE, INCREMENTAL_BUILD, FULL_BUILD).validate()).isEmpty();
        assertThat(PublishPolicy.of(SCHEDULE_RELEASE).validate())
                .singleElement().asString().startsWith("SCHEDULE_RELEASE requires RELEASE");
        assertThat(PublishPolicy.of(FULL_BUILD).validate())
                .singleElement().asString().startsWith("FULL_BUILD requires INCREMENTAL_BUILD");
        assertThat(PublishPolicy.of(SCHEDULE_RELEASE, FULL_BUILD).validate()).hasSize(2);
        long valid = subsets().stream().filter(s -> new PublishPolicy(s).validate().isEmpty()).count();
        assertThat(valid).as("3 release states × 3 build states").isEqualTo(9);
    }

    @Test
    @DisplayName("parse rejects unknown names, each named; JSON round-trips in declaration order")
    void parseAndJson() {
        assertThat(PublishPolicy.parse(List.of("FULL_BUILD", "RELEASE", "RELEASE")).editor())
                .containsExactly(RELEASE, FULL_BUILD);
        assertThatThrownBy(() -> PublishPolicy.parse(List.of("RELEASE", "PUBLISH", "release")))
                .isInstanceOf(PublishPolicy.InvalidPolicyException.class)
                .satisfies(e -> assertThat(((PublishPolicy.InvalidPolicyException) e).errors())
                        .containsExactly("Unknown publish permission 'PUBLISH'.", "Unknown publish permission 'release'."));
        PublishPolicy policy = PublishPolicy.of(INCREMENTAL_BUILD, RELEASE);
        assertThat(policy.toJson().toString()).isEqualTo("{\"editor\":[\"RELEASE\",\"INCREMENTAL_BUILD\"]}");
        assertThat(PublishPolicy.fromJson(policy.toJson())).isEqualTo(policy);
        assertThat(PublishPolicy.fromJson(null)).isEqualTo(PublishPolicy.EMPTY);
    }

    @Test
    @DisplayName("fromJson reads what the migration writes, and ignores names it doesn't know")
    void fromStoredJson() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        assertThat(PublishPolicy.fromJson(mapper.readTree("{\"editor\":[]}"))).isEqualTo(PublishPolicy.EMPTY);
        assertThat(PublishPolicy.fromJson(mapper.readTree("{\"editor\":[\"RELEASE\",\"GONE\"]}")))
                .isEqualTo(PublishPolicy.of(RELEASE));
    }

    @Test
    @DisplayName("requirements: the role first, then permissions in declaration order; ROLE: codes parse")
    void requirements() {
        PublishPolicy release = PublishPolicy.of(RELEASE, SCHEDULE_RELEASE);
        PublishRequirements scheduleThenBuild = PublishRequirements.permission(SCHEDULE_RELEASE)
                .and(PublishRequirements.permission(INCREMENTAL_BUILD));
        assertThat(scheduleThenBuild.missing(ProjectRole.EDITOR, release)).contains("INCREMENTAL_BUILD");
        assertThat(scheduleThenBuild.missing(ProjectRole.EDITOR, PublishPolicy.EMPTY)).contains("SCHEDULE_RELEASE");
        assertThat(scheduleThenBuild.missing(ProjectRole.VIEWER, release)).contains("SCHEDULE_RELEASE");
        assertThat(scheduleThenBuild.missing(ProjectRole.DEVELOPER, PublishPolicy.EMPTY)).isEmpty();

        PublishRequirements developer = PublishRequirements.parse("ROLE:DEVELOPER");
        assertThat(developer.missing(ProjectRole.EDITOR, PublishPolicy.of(PublishPermission.values()))).contains("ROLE:DEVELOPER");
        assertThat(developer.missing(ProjectRole.PROJECT_ADMIN, PublishPolicy.EMPTY)).isEmpty();
        assertThat(developer.and(PublishRequirements.permission(RELEASE)).missing(ProjectRole.EDITOR, release))
                .contains("ROLE:DEVELOPER");
        assertThat(PublishRequirements.parse("RELEASE")).isEqualTo(PublishRequirements.permission(RELEASE));
        assertThatThrownBy(() -> PublishRequirements.parse("RELEASES")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PublishRequirements.parse("ROLE:BOSS")).isInstanceOf(IllegalArgumentException.class);
    }
}
