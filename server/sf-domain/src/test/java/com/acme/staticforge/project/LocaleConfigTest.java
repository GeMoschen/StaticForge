package com.acme.staticforge.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Unit tests for the project locale configuration value type (M24.1.1). */
class LocaleConfigTest {

    private static ProjectLocale locale(String code, String label) {
        return new ProjectLocale(code, label);
    }

    @Test
    @DisplayName("EMPTY is a single-language project")
    void emptyIsNotLocalized() {
        assertThat(LocaleConfig.EMPTY.isLocalized()).isFalse();
        assertThat(LocaleConfig.EMPTY.effectiveChain("de")).isEmpty();
        assertThat(LocaleConfig.EMPTY.codes()).isEmpty();
    }

    @Test
    @DisplayName("codes are canonicalized and labels default to the code")
    void normalizesCodes() {
        LocaleConfig config = LocaleConfig.of(
                List.of(locale("DE", "Deutsch"), locale("de-ch", "  "), locale("en", null)), "de", Map.of(), false);

        assertThat(config.codes()).containsExactly("de", "de-CH", "en");
        assertThat(config.locales().get(1).label()).isEqualTo("de-CH");
        assertThat(config.locales().get(2).label()).isEqualTo("en");
    }

    @Test
    @DisplayName("an ill-formed language tag is rejected")
    void rejectsInvalidTag() {
        assertThatThrownBy(() -> LocaleConfig.of(List.of(locale("not a tag", null)), "de", Map.of(), false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .satisfies(e -> assertThat(((LocaleConfig.LocaleConfigException) e).errors())
                        .anySatisfy(err -> {
                            assertThat(err.field()).isEqualTo("locales[0].code");
                            assertThat(err.message()).contains("not a valid BCP 47 language tag");
                        }));
    }

    @Test
    @DisplayName("duplicate codes are rejected case-insensitively")
    void rejectsDuplicates() {
        assertThatThrownBy(() -> LocaleConfig.of(List.of(locale("de", null), locale("DE", null)), "de", Map.of(), false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .hasMessageContaining("more than once");
    }

    @Test
    @DisplayName("a default locale is required and must be declared")
    void requiresDefault() {
        assertThatThrownBy(() -> LocaleConfig.of(List.of(locale("de", null)), null, Map.of(), false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .hasMessageContaining("default locale is required");

        assertThatThrownBy(() -> LocaleConfig.of(List.of(locale("de", null)), "en", Map.of(), false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .hasMessageContaining("not one of the declared locales");
    }

    @Test
    @DisplayName("a fallback to an undeclared locale is rejected")
    void rejectsUnknownFallbackTarget() {
        assertThatThrownBy(() -> LocaleConfig.of(
                        List.of(locale("de", null), locale("en", null)), "de", Map.of("en", List.of("fr")), false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .hasMessageContaining("'fr' is not one of the declared locales");
    }

    @Test
    @DisplayName("a locale cannot fall back to itself")
    void rejectsSelfFallback() {
        assertThatThrownBy(() -> LocaleConfig.of(List.of(locale("de", null)), "de", Map.of("de", List.of("de")), false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .hasMessageContaining("cannot fall back to itself");
    }

    @Test
    @DisplayName("a cyclic fallback chain de -> en -> de is rejected")
    void rejectsCycle() {
        assertThatThrownBy(() -> LocaleConfig.of(
                        List.of(locale("de", null), locale("en", null)),
                        "de",
                        Map.of("de", List.of("en"), "en", List.of("de")),
                        false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .hasMessageContaining("cyclic");
    }

    @Test
    @DisplayName("a cycle over a chain's second target is detected too")
    void rejectsCycleViaLaterEdge() {
        assertThatThrownBy(() -> LocaleConfig.of(
                        List.of(locale("de", null), locale("en", null), locale("fr", null)),
                        "de",
                        Map.of("de", List.of("fr", "en"), "en", List.of("de")),
                        false))
                .isInstanceOf(LocaleConfig.LocaleConfigException.class)
                .hasMessageContaining("cyclic");
    }

    @Test
    @DisplayName("effectiveChain is locale, declared fallbacks, then the default locale")
    void effectiveChain() {
        LocaleConfig config = LocaleConfig.of(
                List.of(locale("de", null), locale("de-CH", null), locale("en", null)),
                "en",
                Map.of("de-CH", List.of("de")),
                false);

        assertThat(config.effectiveChain("de-CH")).containsExactly("de-CH", "de", "en");
        assertThat(config.effectiveChain("de")).containsExactly("de", "en");
        assertThat(config.effectiveChain("en")).containsExactly("en");
        assertThat(config.effectiveChain("fr")).containsExactly("en");
        assertThat(config.effectiveChain(null)).containsExactly("en");
    }

    @Test
    @DisplayName("the default locale is never duplicated in its own chain")
    void defaultNotDuplicated() {
        LocaleConfig config = LocaleConfig.of(
                List.of(locale("de", null), locale("en", null)), "en", Map.of("de", List.of("en")), false);

        assertThat(config.effectiveChain("de")).containsExactly("de", "en");
    }

    @Test
    @DisplayName("language() returns the language subtag")
    void languageSubtag() {
        assertThat(LocaleConfig.language("de-CH")).isEqualTo("de");
        assertThat(LocaleConfig.language("en")).isEqualTo("en");
        assertThat(LocaleConfig.language(null)).isNull();
    }

    @Test
    @DisplayName("declares() and canonicalDeclared() are case-insensitive")
    void declares() {
        LocaleConfig config = LocaleConfig.of(List.of(locale("de-CH", null)), "de-CH", Map.of(), false);

        assertThat(config.declares("DE-ch")).isTrue();
        assertThat(config.declares("de")).isFalse();
        assertThat(config.canonicalDeclared("de-ch")).isEqualTo("de-CH");
        assertThat(config.canonicalDeclared("fr")).isNull();
    }
}
