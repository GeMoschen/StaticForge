package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Per-locale content validation of {@code localizable} editors (M24.2.1). */
class LocalizableContentValidatorTest {

    private static final LocalizationContext DE_EN =
            new LocalizationContext(true, "de", List.of("de", "en"));

    private static ContentValidator validator(LocalizationContext localization) {
        return new ContentValidator(new ExpressionEvaluator(), null, null, localization);
    }

    private static ContentDefinition definition(String cdl) {
        CdlResult result = new CdlCompiler().compile(cdl);
        assertThat(result.diagnostics()).isEmpty();
        return result.definition();
    }

    private static final ContentDefinition HEADLINE = definition(
            """
            content {
              editor text headline { label "Headline" localizable maxLength 10 }
              editor text sku { label "SKU" }
            }
            """);

    @Test
    @DisplayName("a wrapper with a valid value per locale passes")
    void validWrapper() {
        List<ContentIssue> issues = validator(DE_EN).validate(
                HEADLINE,
                JsonUtil.parse(
                        """
                        {"headline":{"type":"L10N","values":{"de":"Parka","en":"Parka"}},"sku":"A-1"}"""));

        assertThat(issues).isEmpty();
    }

    @Test
    @DisplayName("each locale is validated on its own and the issue path names the locale")
    void perLocaleConstraints() {
        List<ContentIssue> issues = validator(DE_EN).validate(
                HEADLINE,
                JsonUtil.parse(
                        """
                        {"headline":{"type":"L10N","values":{"de":"kurz","en":"far too long a headline"}}}"""));

        assertThat(issues)
                .singleElement()
                .satisfies(issue -> {
                    assertThat(issue.code()).isEqualTo("maxLength");
                    assertThat(issue.path()).isEqualTo("headline.values.en");
                    assertThat(issue.severity()).isEqualTo(Severity.ERROR);
                });
    }

    @Test
    @DisplayName("required is enforced for the default locale only")
    void requiredOnDefaultLocaleOnly() {
        ContentDefinition def = definition(
                """
                content {
                  editor text headline { label "Headline" localizable required }
                }
                """);

        // Only the default locale filled: complete.
        assertThat(validator(DE_EN).validate(
                        def, JsonUtil.parse("{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Da\"}}}")))
                .isEmpty();

        // Default locale missing: one finding, on the default locale's path.
        assertThat(validator(DE_EN).validate(
                        def, JsonUtil.parse("{\"headline\":{\"type\":\"L10N\",\"values\":{\"en\":\"Here\"}}}")))
                .singleElement()
                .satisfies(issue -> {
                    assertThat(issue.code()).isEqualTo("required");
                    assertThat(issue.path()).isEqualTo("headline.values.de");
                });

        // No value at all: same finding.
        assertThat(validator(DE_EN).validate(def, JsonUtil.parse("{}")))
                .singleElement()
                .satisfies(issue -> assertThat(issue.code()).isEqualTo("required"));
    }

    @Test
    @DisplayName("a value for an undeclared locale is a warning, not an error")
    void undeclaredLocaleIsWarning() {
        List<ContentIssue> issues = validator(DE_EN).validate(
                HEADLINE,
                JsonUtil.parse("{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"Parka\",\"fr\":\"Parka\"}}}"));

        assertThat(issues)
                .singleElement()
                .satisfies(issue -> {
                    assertThat(issue.code()).isEqualTo("locale");
                    assertThat(issue.severity()).isEqualTo(Severity.WARNING);
                    assertThat(issue.kind()).isEqualTo(ContentIssue.Kind.COMPLETENESS);
                    assertThat(issue.path()).isEqualTo("headline.values.fr");
                    assertThat(issue.message()).contains("The value is kept.");
                });
    }

    @Test
    @DisplayName("a localizable editor holding a bare value is a structural error")
    void bareValueOnLocalizableEditor() {
        List<ContentIssue> issues =
                validator(DE_EN).validate(HEADLINE, JsonUtil.parse("{\"headline\":\"Parka\"}"));

        assertThat(issues)
                .singleElement()
                .satisfies(issue -> {
                    assertThat(issue.code()).isEqualTo("type");
                    assertThat(issue.kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
                    assertThat(issue.message()).contains("must hold a value per language");
                });
    }

    @Test
    @DisplayName("a non-localizable editor holding a wrapper is a structural error")
    void wrapperOnPlainEditor() {
        List<ContentIssue> issues = validator(DE_EN).validate(
                HEADLINE, JsonUtil.parse("{\"sku\":{\"type\":\"L10N\",\"values\":{\"de\":\"A-1\"}}}"));

        assertThat(issues)
                .anySatisfy(issue -> {
                    assertThat(issue.code()).isEqualTo("type");
                    assertThat(issue.message()).contains("is not language-dependent");
                });
    }

    @Test
    @DisplayName("in a project without locales, localizable is inactive and values stay bare")
    void inactiveWithoutProjectLocales() {
        ContentValidator plain = validator(LocalizationContext.NONE);

        assertThat(plain.validate(HEADLINE, JsonUtil.parse("{\"headline\":\"Parka\"}"))).isEmpty();
        assertThat(plain.validate(HEADLINE, JsonUtil.parse("{\"headline\":\"far too long\"}")))
                .anyMatch(issue -> issue.code().equals("maxLength"));
        assertThat(plain.validate(HEADLINE, JsonUtil.parse("{\"headline\":{\"type\":\"L10N\",\"values\":{\"de\":\"x\"}}}")))
                .anySatisfy(issue -> {
                    assertThat(issue.code()).isEqualTo("type");
                    assertThat(issue.message()).contains("is not language-dependent");
                });
    }

    @Test
    @DisplayName("a localizable leaf inside a list item is validated per locale")
    void insideListItem() {
        ContentDefinition def = definition(
                """
                content {
                  editor list links {
                    label "Links"
                    item { editor text caption { label "Caption" localizable maxLength 4 } }
                  }
                }
                """);

        List<ContentIssue> issues = validator(DE_EN).validate(
                def,
                JsonUtil.parse(
                        """
                        {"links":[{"caption":{"type":"L10N","values":{"de":"ok","en":"far too long"}}}]}"""));

        assertThat(issues)
                .singleElement()
                .satisfies(issue -> assertThat(issue.path()).isEqualTo("links[0].caption.values.en"));
    }

    @Test
    @DisplayName("visibleWhen on the server evaluates against the default locale's value")
    void visibleWhenUsesDefaultLocale() {
        ContentDefinition def = definition(
                """
                content {
                  editor select mode {
                    label "Mode"
                    localizable
                    options [ { value "a", label "A" }, { value "b", label "B" } ]
                  }
                  editor text detail { label "Detail" required visibleWhen "mode == 'a'" }
                }
                """);

        // Default locale (de) says "a" → `detail` is visible and its emptiness is reported…
        assertThat(validator(DE_EN).validate(
                        def, JsonUtil.parse("{\"mode\":{\"type\":\"L10N\",\"values\":{\"de\":\"a\",\"en\":\"b\"}}}")))
                .anyMatch(issue -> issue.code().equals("required") && issue.path().equals("detail"));

        // …and hidden when the default locale says otherwise, whatever the other locales hold.
        assertThat(validator(DE_EN).validate(
                        def, JsonUtil.parse("{\"mode\":{\"type\":\"L10N\",\"values\":{\"de\":\"b\",\"en\":\"a\"}}}")))
                .noneMatch(issue -> issue.path().equals("detail"));
    }
}
