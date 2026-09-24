package com.acme.staticforge.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acme.staticforge.common.SfException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Unit tests for the password rules applied wherever a password is set (M26.1.1). */
class PasswordPolicyTest {

    private static final String EMOJI = "😀"; // one character, two UTF-16 units, four UTF-8 bytes
    private static final String UMLAUT = "ä"; // one character, two UTF-8 bytes

    private static PasswordPolicy policy(int minLength, boolean requireMixed) {
        PasswordPolicyProperties properties = new PasswordPolicyProperties();
        properties.setMinLength(minLength);
        properties.setRequireMixed(requireMixed);
        return new PasswordPolicy(properties);
    }

    @Test
    @DisplayName("defaults: 12 characters, no mix required")
    void defaults() {
        PasswordPolicy policy = new PasswordPolicy(new PasswordPolicyProperties());

        assertThat(policy.minLength()).isEqualTo(12);
        assertThat(policy.requireMixed()).isFalse();
        assertThat(policy.validate("abcdefghijkl")).isEmpty();
        assertThat(policy.validate("abcdefghijk")).containsExactly("Password must be at least 12 characters long.");
    }

    @Test
    @DisplayName("minimum length counts characters, not bytes or UTF-16 units")
    void minLengthCountsCodePoints() {
        PasswordPolicy policy = policy(4, false);

        assertThat(policy.validate(UMLAUT.repeat(4))).isEmpty();
        // Three emoji are six UTF-16 units but three characters.
        assertThat(policy.validate(EMOJI.repeat(3))).containsExactly("Password must be at least 4 characters long.");
    }

    @Test
    @DisplayName("an empty or missing password is always refused, even with min-length 0")
    void emptyIsRefused() {
        PasswordPolicy policy = policy(0, false);

        assertThat(policy.validate("")).hasSize(1);
        assertThat(policy.validate(null)).hasSize(1);
    }

    @Test
    @DisplayName("require-mixed off accepts letters only; on needs a letter and a digit or symbol")
    void requireMixed() {
        assertThat(policy(8, false).validate("onlyletters")).isEmpty();

        PasswordPolicy mixed = policy(8, true);
        assertThat(mixed.validate("onlyletters")).containsExactly("Password must contain at least one digit or symbol.");
        assertThat(mixed.validate("1234567890")).containsExactly("Password must contain at least one letter.");
        assertThat(mixed.validate("letters and spaces"))
                .containsExactly("Password must contain at least one digit or symbol.");
        assertThat(mixed.validate("letters4ever")).isEmpty();
        assertThat(mixed.validate("letters-ever")).isEmpty();
    }

    @Test
    @DisplayName("72 UTF-8 bytes is the ceiling, counted in bytes for multi-byte characters")
    void maxBytes() {
        PasswordPolicy policy = policy(1, false);

        assertThat(policy.validate("a".repeat(72))).isEmpty();
        assertThat(policy.validate("a".repeat(73))).singleElement().asString().contains("72 bytes");
        // 36 umlauts are 36 characters but exactly 72 bytes; one more crosses the limit.
        assertThat(UMLAUT.repeat(36).getBytes(StandardCharsets.UTF_8)).hasSize(72);
        assertThat(policy.validate(UMLAUT.repeat(36))).isEmpty();
        assertThat(policy.validate(UMLAUT.repeat(37))).hasSize(1);
        // 19 four-byte emoji: 19 characters, 76 bytes.
        assertThat(policy.validate(EMOJI.repeat(19))).hasSize(1);
    }

    @Test
    @DisplayName("every broken rule is reported together")
    void severalRulesTogether() {
        PasswordPolicy policy = policy(100, true);

        List<String> errors = policy.validate(EMOJI.repeat(19));

        assertThat(errors)
                .containsExactly(
                        "Password must be at least 100 characters long.",
                        "Password must be at most 72 bytes long (UTF-8); characters outside ASCII take two to four"
                                + " bytes each.",
                        "Password must contain at least one letter.");
    }

    @Test
    @DisplayName("requireValid throws 400 SF-API-0400 with the errors list")
    void requireValidThrowsProblemWithErrors() {
        PasswordPolicy policy = policy(12, true);

        assertThatThrownBy(() -> policy.requireValid("short")).isInstanceOfSatisfying(SfException.class, e -> {
            assertThat(e.getProblem().getStatus()).isEqualTo(400);
            assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-API-0400");
            assertThat(e.getProblem().getExtensions().get("errors"))
                    .isEqualTo(List.of(
                            "Password must be at least 12 characters long.",
                            "Password must contain at least one digit or symbol."));
        });
        policy.requireValid("long-enough-1");
    }
}
