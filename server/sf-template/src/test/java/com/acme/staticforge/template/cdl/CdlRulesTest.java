package com.acme.staticforge.template.cdl;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EffectiveDefinition;
import com.acme.staticforge.template.diagnostic.Diagnostic;
import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.rules.BuiltinRule;
import com.acme.staticforge.template.rules.FillDefinition;
import com.acme.staticforge.template.rules.FillMode;
import com.acme.staticforge.template.rules.LocaleSelector;
import com.acme.staticforge.template.rules.OnGeneration;
import com.acme.staticforge.template.rules.RuleDefinition;
import com.acme.staticforge.template.rules.RuleLevel;
import com.acme.staticforge.template.rules.RuleScope;
import com.acme.staticforge.template.rules.RuleSet;
import com.acme.staticforge.template.rules.StateDefinition;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The CDL {@code rules {}} section and built-in modifiers (M33.2). */
class CdlRulesTest {

    private final CdlCompiler compiler = new CdlCompiler();

    private static final String EDITORS = """
            content {
              editor text title { label "Title" required }
              editor select category { options [ { value "news" label "News" }, { value "page" label "Page" } ] }
              editor text teaser { label "Teaser" }
              editor text slug { label "Slug" }
              editor date publishDate { label "Published" }
              editor media image { label "Image" }
              group "SEO" { editor text seoTitle { label "SEO title" } }
              editor list gallery {
                item { editor media picture { label "Picture" } editor text caption { label "Caption" } }
              }
            }
            bodies { body main { allow ["hero", "text"] } }
            """;

    /** The epic README example, verbatim apart from the editor name {@code type} (reserved) — it is {@code category} here. */
    private static final String README_RULES = """
            rules {
              rule "title-length" on title {
                level warning
                scope [edit, save]
                when "category == 'news'"                        // optional precondition
                assert "length(value) <= 70"
                message { en "Keep titles under 70 characters ({length})" de "Titel unter 70 Zeichen halten ({length})" }
                locales all
              }
              rule "caption-per-image" on gallery[] {
                level error  scope [release, generation]  onGeneration holdBack
                assert "!isEmpty(item.caption)"
                message { en "Image {index} needs a caption" }
              }
              rule "one-hero" on page {
                level error  scope [save, release]
                assert "count(sections(body.main, 'hero')) == 1"
                message { en "Exactly one hero section" }
              }
              rule "alt-text" on image {
                level warning  scope [edit, release]
                assert "!isEmpty(ref(value).meta.alt)"
                message { en "The selected image has no alt text" }
              }
              state teaser { requiredWhen "category == 'news'"  readOnlyWhen "release.status == 'PUBLISHED'" }
              fill slug { value "slugify(title)"  mode empty  on [edit, save] }
              fill publishDate { value "today()"  mode empty  on [release] }
              rule "legacy-check" off
            }
            """;

    private CdlResult compile(String source) {
        return compiler.compile(source);
    }

    private static List<String> codes(List<Diagnostic> diagnostics) {
        return diagnostics.stream().map(Diagnostic::code).toList();
    }

    private List<String> errorCodes(String rules) {
        return compile(EDITORS + rules).diagnostics().stream()
                .filter(d -> d.severity() == Severity.ERROR)
                .map(Diagnostic::code)
                .toList();
    }

    /** Compiles and resolves standalone, as a page template's live check and a dataset do. */
    private List<Diagnostic> resolved(String source) {
        CdlResult result = compile(source);
        List<Diagnostic> all = new java.util.ArrayList<>(result.diagnostics());
        all.addAll(com.acme.staticforge.template.rules.RuleResolution.check(
                result.definition().rules(), result.definition(), result.definition().rules()));
        return all;
    }

    @Test
    @DisplayName("the README example compiles into rules, a state and fills, keeping the order written")
    void readmeExampleRoundTrips() {
        // A layer switching off a rule it doesn't inherit: the "off" is kept for the merge to judge.
        CdlResult result = compile(EDITORS + README_RULES);
        assertThat(result.diagnostics()).isEmpty();
        RuleSet rules = result.definition().rules();

        assertThat(rules.rules()).extracting(RuleDefinition::name)
                .containsExactly("title-length", "caption-per-image", "one-hero", "alt-text");
        RuleDefinition titleLength = rules.rule("title-length").orElseThrow();
        assertThat(titleLength.target().text()).isEqualTo("title");
        assertThat(titleLength.level()).isEqualTo(RuleLevel.WARNING);
        assertThat(titleLength.scopes()).containsExactlyInAnyOrder(RuleScope.EDIT, RuleScope.SAVE);
        assertThat(titleLength.when().source()).isEqualTo("category == 'news'");
        assertThat(titleLength.assertion().identifiers()).containsExactly("value");
        assertThat(titleLength.messages().resolve("de")).isEqualTo("Titel unter 70 Zeichen halten ({length})");
        assertThat(titleLength.messages().resolve("fr")).isEqualTo("Keep titles under 70 characters ({length})");
        assertThat(titleLength.locales()).isEqualTo(LocaleSelector.ALL);

        RuleDefinition caption = rules.rule("caption-per-image").orElseThrow();
        assertThat(caption.target().hasRows()).isTrue();
        assertThat(caption.target().text()).isEqualTo("gallery[]");
        assertThat(caption.onGeneration()).isEqualTo(OnGeneration.HOLD_BACK);
        assertThat(rules.rule("one-hero").orElseThrow().target().whole()).isEqualTo("page");

        StateDefinition teaser = rules.states().get(0);
        assertThat(teaser.target().text()).isEqualTo("teaser");
        assertThat(teaser.requiredWhen().source()).isEqualTo("category == 'news'");
        assertThat(teaser.readOnlyWhen().identifiers()).containsExactly("release.status");
        assertThat(teaser.level()).as("defaults to the editor's required built-in").isNull();

        assertThat(rules.fills()).extracting(f -> f.target().text()).containsExactly("slug", "publishDate");
        FillDefinition publish = rules.fills().get(1);
        assertThat(publish.mode()).isEqualTo(FillMode.EMPTY);
        assertThat(publish.on()).containsExactly(RuleScope.RELEASE);
        assertThat(rules.off()).containsExactly("legacy-check");
    }

    @Test
    @DisplayName("a definition with rules serializes (templates, datasets and property sets store it as JSON)")
    void aDefinitionWithRulesSerializes() {
        var json = new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(compile(EDITORS + README_RULES).definition());
        assertThat(json.at("/rules/rules/0/name").asText()).isEqualTo("title-length");
        assertThat(json.at("/rules/rules/0/assertion").asText()).isEqualTo("length(value) <= 70");
        assertThat(json.at("/rules/rules/0/target/text").asText()).isEqualTo("title");
        assertThat(json.at("/rules/rules/0/messages/byLanguage/de").asText()).startsWith("Titel");
        assertThat(json.at("/rules/fills/0/value").asText()).isEqualTo("slugify(title)");
        var builtins = new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(
                compile("content { editor text t { required level warning } }").definition());
        assertThat(builtins.at("/editors/0/builtinRules/required/level").asText()).isEqualTo("WARNING");
    }

    @Test
    void theReadmeExampleResolvesAgainstItsEditors() {
        assertThat(resolved(EDITORS + README_RULES)).isEmpty();
    }

    @Nested
    class BuiltinModifiers {

        @Test
        void modifiersFollowTheAttributeInAnyOrder() {
            CdlResult result = compile("""
                    content {
                      editor text title {
                        required level warning scope [release]
                        maxLength 160 level info scope [edit]
                        validate pattern "^[A-Z]" message "Start with a capital" level hint
                        validate maxChars 40 scope [edit, save] message { en "Too long ({max})" de "Zu lang ({max})" }
                      }
                      editor list tags { min 1 max 5 onGeneration holdBack }
                    }
                    """);
            assertThat(result.diagnostics()).isEmpty();
            var title = result.definition().findEditor("title").orElseThrow();
            assertThat(title.required()).isTrue();
            assertThat(title.maxLength()).isEqualTo(160);
            BuiltinRule required = title.builtinRule("required");
            assertThat(required.level()).isEqualTo(RuleLevel.WARNING);
            assertThat(required.scopes()).containsExactly(RuleScope.RELEASE);
            assertThat(title.builtinRule("maxLength").level()).isEqualTo(RuleLevel.INFO);
            assertThat(title.pattern()).isEqualTo("^[A-Z]");
            assertThat(title.patternMessage()).as("still readable").isEqualTo("Start with a capital");
            assertThat(title.builtinRule("pattern").messages().resolve("en")).isEqualTo("Start with a capital");
            assertThat(title.builtinRule("pattern").level()).isEqualTo(RuleLevel.HINT);
            assertThat(title.builtinRule("maxChars").messages().resolve("de")).isEqualTo("Zu lang ({max})");
            var tags = result.definition().findEditor("tags").orElseThrow();
            assertThat(tags.builtinRule("max").onGeneration()).isEqualTo(OnGeneration.HOLD_BACK);
            assertThat(tags.builtinRule("min").isDefault()).as("only max carries modifiers").isTrue();
        }

        @Test
        void editorsWithoutModifiersKeepTodaysDefinition() {
            CdlResult result = compile("""
                    content { editor text title { required maxLength 20 validate pattern "x" } }
                    """);
            var title = result.definition().findEditor("title").orElseThrow();
            assertThat(title.builtinRules()).isEmpty();
            assertThat(title.builtinRule("required").isDefault()).isTrue();
        }

        @Test
        void invalidModifiersAreSfCdl0119() {
            assertThat(codes(compile("content { editor text t { required level loud } }").diagnostics()))
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
            assertThat(codes(compile("content { editor text t { required scope [later] } }").diagnostics()))
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
            assertThat(codes(compile("content { editor text t { required level warning onGeneration fail } }").diagnostics()))
                    .as("onGeneration needs level error")
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
            assertThat(codes(compile("content { editor text t { required scope [save] onGeneration fail } }").diagnostics()))
                    .as("onGeneration needs scope generation")
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
            assertThat(codes(compile("content { editor text t { required onGeneration fail } }").diagnostics()))
                    .as("the defaults are error in generation")
                    .isEmpty();
            assertThat(codes(compile("content { editor text t { required message { en \"{oops}\" } } }").diagnostics()))
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
        }
    }

    @Nested
    class Errors {

        @Test
        void entrySyntaxAndKeywordsAreSfCdl0113() {
            assertThat(errorCodes("rules { rule \"a\" on title { level warning scope [edit] assert \"true\" message { en \"x\" } colour red } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { rule \"a\" on title { level loud scope [edit] assert \"true\" message { en \"x\" } } }"))
                    .contains(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { rule \"a\" on title { level info scope [later] assert \"true\" message { en \"x\" } } }"))
                    .contains(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { fill slug { value \"title\" on [generation] } }"))
                    .as("fills never run at generation")
                    .contains(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { fill slug { value \"title\" mode sometimes on [save] } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { state page { requiredWhen \"true\" } }"))
                    .as("a state applies to an editor")
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { rule \"a\" on title { level info scope [edit] assert \"true\" message { en \"{nope}\" } } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { rule on title { } }")).contains(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { banana }")).containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { } rules { }")).as("one rules section per source")
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(errorCodes("rules { rule \"a\" { level info scope [edit] assert \"true\" message { en \"x\" }"
                    + " locales [default, de] } }")).containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
        }

        @Test
        void missingKeysAreSfCdl0114() {
            assertThat(errorCodes("rules { rule \"a\" on title { assert \"true\" message { en \"x\" } } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_MISSING_KEY, DiagnosticCodes.CDL_RULE_MISSING_KEY);
            assertThat(errorCodes("rules { rule \"a\" on title { level info scope [edit] } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_MISSING_KEY, DiagnosticCodes.CDL_RULE_MISSING_KEY);
            assertThat(errorCodes("rules { fill slug { mode always } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_MISSING_KEY, DiagnosticCodes.CDL_RULE_MISSING_KEY);
            assertThat(errorCodes("rules { state teaser { level warning } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_MISSING_KEY);
        }

        @Test
        void expressionsAreSfCdl0116() {
            String rule = "rules { rule \"a\" on title { level info scope [edit] message { en \"x\" } assert \"%s\" } }";
            assertThat(errorCodes(rule.formatted("length(value) <")))
                    .containsExactly(DiagnosticCodes.CDL_RULE_EXPRESSION);
            assertThat(errorCodes(rule.formatted("frobnicate(value)")))
                    .containsExactly(DiagnosticCodes.CDL_RULE_EXPRESSION);
            assertThat(errorCodes(rule.formatted("length(value, 2) > 1")))
                    .containsExactly(DiagnosticCodes.CDL_RULE_EXPRESSION);
            assertThat(errorCodes(rule.formatted("'yes'")))
                    .as("a constant that isn't a condition")
                    .containsExactly(DiagnosticCodes.CDL_RULE_EXPRESSION);
            assertThat(errorCodes(rule.formatted("value = 'x'")))
                    .as("the single '=' is an error in rules")
                    .containsExactly(DiagnosticCodes.CDL_RULE_EXPRESSION);
            assertThat(errorCodes(rule.formatted("true"))).isEmpty();
        }

        @Test
        void duplicatesAndFillCyclesAreSfCdl0117() {
            String rule = "rule \"a\" on title { level info scope [edit] assert \"true\" message { en \"x\" } }";
            assertThat(errorCodes("rules { " + rule + " " + rule + " }")).containsExactly(DiagnosticCodes.CDL_RULE_DUPLICATE);
            assertThat(errorCodes("rules { fill slug { value \"title\" on [save] } fill slug { value \"teaser\" on [save] } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_DUPLICATE);
            assertThat(errorCodes("rules { state teaser { requiredWhen \"true\" } state teaser { readOnlyWhen \"true\" } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_DUPLICATE);
            List<Diagnostic> cycle = compile(EDITORS
                    + "rules { fill slug { value \"slugify(teaser)\" on [save] } fill teaser { value \"slug + '!'\" on [save] } }")
                    .diagnostics();
            assertThat(codes(cycle)).containsExactly(DiagnosticCodes.CDL_RULE_DUPLICATE);
            assertThat(cycle.get(0).message()).contains("slug → teaser → slug");
            assertThat(errorCodes("rules { fill slug { value \"slug + '-x'\" on [save] } }"))
                    .as("a fill reading its own field by name")
                    .containsExactly(DiagnosticCodes.CDL_RULE_DUPLICATE);
            assertThat(errorCodes("rules { fill slug { value \"trim(value)\" on [save] } }"))
                    .as("reading it as value is fine")
                    .isEmpty();
        }

        @Test
        void builtinNamesAndMisusedOnGenerationAreSfCdl0119() {
            assertThat(errorCodes("rules { rule \"required\" on title { level info scope [edit] assert \"true\" message { en \"x\" } } }"))
                    .containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
            assertThat(errorCodes("rules { rule \"maxLength\" off }")).containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
            assertThat(errorCodes("rules { rule \"a\" on title { level warning scope [generation] onGeneration fail"
                    + " assert \"true\" message { en \"x\" } } }")).containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
            assertThat(errorCodes("rules { rule \"a\" on title { level error scope [release] onGeneration fail"
                    + " assert \"true\" message { en \"x\" } } }")).containsExactly(DiagnosticCodes.CDL_RULE_INVALID_MODIFIER);
        }

        @Test
        void unknownTargetsAndIdentifiersAreSfCdl0115() {
            String rule = "rules { rule \"a\" on %s { level info scope [edit] assert \"%s\" message { en \"x\" } } }";
            assertThat(codes(resolved(EDITORS + rule.formatted("nope", "true")))).containsExactly(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
            assertThat(codes(resolved(EDITORS + rule.formatted("title[]", "true"))))
                    .as("title is not a list")
                    .containsExactly(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
            assertThat(codes(resolved(EDITORS + rule.formatted("gallery.caption", "true"))))
                    .as("a list's fields need []")
                    .containsExactly(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
            assertThat(codes(resolved(EDITORS + rule.formatted("title", "subtitle == 'x'"))))
                    .containsExactly(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
            assertThat(codes(resolved(EDITORS + rule.formatted("title", "item.caption == 'x'"))))
                    .as("item exists only on rows")
                    .containsExactly(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
            assertThat(resolved(EDITORS + rule.formatted("gallery[].caption", "length(item.caption) > index + 1")))
                    .isEmpty();
            assertThat(resolved(EDITORS + rule.formatted("seoTitle", "seoTitle != title and locale != defaultLocale")))
                    .as("group members resolve by name; named roots always")
                    .isEmpty();
            assertThat(resolved(EDITORS + rule.formatted("seoTitle", "global:site.title != ''"))).isEmpty();
        }
    }

    @Nested
    class Inheritance {

        private static final String PARENT = """
                content { editor text title { label "T" } editor text subtitle { label "S" } }
                rules {
                  rule "title-length" on title { level warning scope [edit] assert "length(value) <= 70" message { en "70" } }
                  rule "subtitle-set" on subtitle { level info scope [edit] assert "!isEmpty(value)" message { en "set" } }
                  fill subtitle { value "title" on [save] }
                }
                """;

        private EffectiveDefinition chain(String child) {
            ContentDefinition parent = new CdlCompiler().compile(PARENT).definition();
            ContentDefinition own = new CdlCompiler().compile(child).definition();
            return EffectiveDefinition.merge(List.of(
                    new EffectiveDefinition.Layer("base", parent), new EffectiveDefinition.Layer("child", own)));
        }

        @Test
        void aChildAddsOverridesByNameAndSwitchesOff() {
            EffectiveDefinition effective = chain("""
                    content { editor text teaser { label "Teaser" } }
                    rules {
                      rule "title-length" on title { level error scope [edit, release] assert "length(value) <= 60" message { en "60" } }
                      rule "subtitle-set" off
                      rule "teaser-set" on teaser { level hint scope [edit] assert "!isEmpty(value)" message { en "teaser" } }
                      fill subtitle { value "title + '!'" mode always on [save] }
                    }
                    """);
            assertThat(effective.diagnostics()).isEmpty();
            RuleSet rules = effective.definition().rules();
            assertThat(rules.rules()).extracting(RuleDefinition::name).containsExactly("title-length", "teaser-set");
            RuleDefinition overridden = rules.rule("title-length").orElseThrow();
            assertThat(overridden.level()).isEqualTo(RuleLevel.ERROR);
            assertThat(overridden.assertion().source()).isEqualTo("length(value) <= 60");
            assertThat(rules.fills()).hasSize(1);
            assertThat(rules.fills().get(0).mode()).as("the child's fill replaces the parent's").isEqualTo(FillMode.ALWAYS);
            assertThat(rules.off()).isEmpty();
        }

        @Test
        void aChildsRulesMayTargetInheritedEditors() {
            EffectiveDefinition effective = chain("""
                    rules { rule "t" on title { level info scope [edit] assert "value != subtitle" message { en "x" } } }
                    """);
            assertThat(effective.diagnostics()).isEmpty();
        }

        @Test
        void unknownNamesAndOverridesAreReportedForTheChild() {
            EffectiveDefinition effective = chain("""
                    rules {
                      rule "never-defined" off
                      rule "t" on teaser { level info scope [edit] assert "true" message { en "x" } }
                    }
                    """);
            assertThat(codes(effective.diagnostics()))
                    .containsExactlyInAnyOrder(DiagnosticCodes.CDL_RULE_UNKNOWN_OVERRIDE, DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
        }

        @Test
        void aCycleAcrossTheChainIsReportedOnTheChildsFill() {
            EffectiveDefinition effective = chain("rules { fill title { value \"subtitle\" on [save] } }");
            assertThat(codes(effective.diagnostics())).containsExactly(DiagnosticCodes.CDL_RULE_DUPLICATE);
        }

        @Test
        void aChildCannotRelevelAnInheritedBuiltin() {
            EffectiveDefinition effective = chain("content { editor text title { required level warning } }");
            assertThat(codes(effective.diagnostics()))
                    .as("redeclaring the editor is the existing collision; the ancestor's editor wins")
                    .containsExactly(DiagnosticCodes.CDL_INHERITED_NAME_COLLISION);
            assertThat(effective.definition().findEditor("title").orElseThrow().builtinRules()).isEmpty();
        }
    }

    @Nested
    class Kinds {

        @Test
        void wholeDefinitionTargetsMatchTheKind() {
            String rules = "rules { rule \"r\" on %s { level info scope [edit] assert \"true\" message { en \"x\" } } }";
            ContentDefinition onPage = compile("content { editor text t { } }" + rules.formatted("page")).definition();
            assertThat(codes(TemplateRuleCdlRules.pageTemplate(onPage))).isEmpty();
            assertThat(codes(TemplateRuleCdlRules.sectionTemplate(onPage))).containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            assertThat(codes(DatasetCdlRules.check(onPage))).containsExactly(DiagnosticCodes.CDL_RULE_INVALID);
            ContentDefinition onRecord = compile("content { editor text t { } }" + rules.formatted("record")).definition();
            assertThat(codes(DatasetCdlRules.check(onRecord))).isEmpty();
            ContentDefinition onGlobal = compile("content { editor text t { } }" + rules.formatted("global")).definition();
            assertThat(codes(GlobalSetCdlRules.check(onGlobal))).isEmpty();
            ContentDefinition noTarget = compile("content { editor text t { } }"
                    + "rules { rule \"r\" { level info scope [edit] assert \"true\" message { en \"x\" } } }").definition();
            assertThat(codes(GlobalSetCdlRules.check(noTarget))).as("no 'on' fits every kind").isEmpty();
        }

        @Test
        void datasetsAndPropertySetsResolveNamesStandalone() {
            ContentDefinition def = compile("content { editor text t { } }"
                    + "rules { rule \"r\" on nope { level info scope [edit] assert \"true\" message { en \"x\" } } }").definition();
            assertThat(codes(DatasetCdlRules.check(def))).containsExactly(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
            assertThat(codes(GlobalSetCdlRules.check(def))).containsExactly(DiagnosticCodes.CDL_RULE_UNKNOWN_PATH);
        }

        @Test
        void theLiveCheckOfAPageTemplateWarnsForNamesItCantSee() {
            ContentDefinition def = compile("content { editor text t { } }"
                    + "rules { rule \"r\" on inherited { level info scope [edit] assert \"true\" message { en \"x\" } } }").definition();
            List<Diagnostic> diagnostics = TemplateRuleCdlRules.pageTemplateWithoutChain(def);
            assertThat(diagnostics).extracting(Diagnostic::severity).containsExactly(Severity.WARNING);
        }
    }

    @Test
    @DisplayName("visibleWhen stays v1: v2-only syntax is SF-CDL-0105")
    void visibleWhenStaysVersionOne() {
        assertThat(codes(compile("content { editor text a { visibleWhen \"length(b) > 1\" } editor text b { } }").diagnostics()))
                .containsExactly(DiagnosticCodes.CDL_INVALID_EXPRESSION);
        assertThat(codes(compile("content { editor text a { visibleWhen \"b = 'x'\" } editor text b { } }").diagnostics()))
                .as("the v1 single '=' still compiles")
                .isEmpty();
    }

    @Test
    void positionsPointAtTheEntry() {
        List<Diagnostic> diagnostics = compile("""
                content { editor text title { } }
                rules {
                  rule "a" on title { level info scope [edit] assert "length(" message { en "x" } }
                }
                """).diagnostics();
        assertThat(diagnostics).hasSize(1);
        assertThat(diagnostics.get(0).line()).isEqualTo(3);
        assertThat(diagnostics.get(0).column()).isGreaterThan(40);
        assertThat(Set.of(diagnostics.get(0).code())).containsExactly(DiagnosticCodes.CDL_RULE_EXPRESSION);
    }
}
