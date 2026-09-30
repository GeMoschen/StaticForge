package com.acme.staticforge.asset.rules;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.ContentValidator;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.ExpressionEvaluator;
import com.acme.staticforge.template.rules.FillMode;
import com.acme.staticforge.template.rules.OnGeneration;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The editor-rule engine (M33.3). */
class RuleEngineTest {

    private static final LocalizationContext DE_EN = new LocalizationContext(true, "de", List.of("de", "en"));

    private static ContentDefinition definition(String cdl) {
        CdlResult result = new CdlCompiler().compile(cdl);
        assertThat(result.diagnostics()).isEmpty();
        return result.definition();
    }

    private static RuleEngine engine() {
        return engine(LocalizationContext.NONE, null);
    }

    private static RuleEngine engine(LocalizationContext localization, String uiLanguage) {
        return new RuleEngine(new ContentValidator(new ExpressionEvaluator(), null, null, localization).withUiLanguage(uiLanguage));
    }

    private static RuleOutcome run(ContentDefinition definition, String content, RuleScope scope) {
        return engine().evaluate(definition, JsonUtil.parse(content), "record", "", RuleEngine.Request.of(scope));
    }

    private static List<String> rules(RuleOutcome outcome) {
        return outcome.findings().stream().map(ContentIssue::rule).toList();
    }

    private static final ContentDefinition ARTICLE = definition("""
            content {
              editor select category { options [ { value "news" label "News" }, { value "page" label "Page" } ] }
              editor text title { label "Title" }
              editor text teaser { label "Teaser" }
              editor text slug { label "Slug" }
            }
            rules {
              rule "title-hint" on title { level hint scope [edit] assert "length(value) >= 10" message { en "Longer is better ({length})" } }
              rule "title-info" on title { level info scope [edit, save] assert "!matches(value, '!$')" message { en "No exclamation marks" } }
              rule "title-warning" on title { level warning scope [release] assert "length(value) <= 20" message { en "At most {max} chars" } }
              rule "title-error" on title { level error scope [generation] onGeneration fail assert "value != 'TBD'" message { en "Not TBD" } }
              rule "news-teaser" on teaser { level error scope [save] when "category == 'news'" assert "!isEmpty(value)"
                message { en "News need a teaser" de "News brauchen einen Teaser" } }
            }
            """);

    @Nested
    class ScopesAndLevels {

        @Test
        @DisplayName("each scope runs exactly its rules, with the level as severity")
        void eachScopeSelectsItsRules() {
            String content = "{\"category\":\"news\",\"title\":\"TBD!\"}";
            RuleOutcome edit = run(ARTICLE, content, RuleScope.EDIT);
            assertThat(rules(edit)).containsExactly("title-hint", "title-info");
            assertThat(edit.findings()).extracting(ContentIssue::severity).containsExactly(Severity.HINT, Severity.INFO);
            assertThat(edit.findings().get(0).message()).isEqualTo("Longer is better (4)");
            assertThat(edit.blocks(RuleScope.EDIT)).isFalse();

            RuleOutcome save = run(ARTICLE, content, RuleScope.SAVE);
            assertThat(rules(save)).containsExactly("title-info", "news-teaser");
            assertThat(save.blocks(RuleScope.SAVE)).isTrue();
            assertThat(save.blocking(RuleScope.SAVE)).extracting(ContentIssue::path).containsExactly("teaser");

            RuleOutcome release = run(ARTICLE, "{\"category\":\"page\",\"title\":\"" + "x".repeat(25) + "\"}", RuleScope.RELEASE);
            assertThat(rules(release)).containsExactly("title-warning");
            assertThat(release.findings().get(0).severity()).isEqualTo(Severity.WARNING);
            assertThat(release.findings().get(0).message()).as("{max} is unset without a max: kept as written")
                    .isEqualTo("At most {max} chars");

            RuleOutcome generation = run(ARTICLE, "{\"category\":\"news\",\"title\":\"TBD\"}", RuleScope.GENERATION);
            assertThat(rules(generation)).containsExactly("title-error");
            assertThat(generation.findings().get(0).onGeneration()).isEqualTo(OnGeneration.FAIL);
            assertThat(generation.findings().get(0).code()).isEqualTo(RuleEngine.CODE_RULE);
        }

        @Test
        void whenPreconditionsGateTheRule() {
            assertThat(rules(run(ARTICLE, "{\"category\":\"page\",\"title\":\"Hello world!!\"}", RuleScope.SAVE)))
                    .containsExactly("title-info");
        }

        @Test
        void messagesResolveForTheUiLanguageAndFallBackToTheFirst() {
            String content = "{\"category\":\"news\",\"title\":\"A long enough title\"}";
            RuleOutcome german = engine(LocalizationContext.NONE, "de-AT")
                    .evaluate(ARTICLE, JsonUtil.parse(content), "record", "", RuleEngine.Request.of(RuleScope.SAVE));
            assertThat(german.findings().get(0).message()).isEqualTo("News brauchen einen Teaser");
            assertThat(german.findings().get(0).messages()).containsEntry("en", "News need a teaser");
            RuleOutcome french = engine(LocalizationContext.NONE, "fr")
                    .evaluate(ARTICLE, JsonUtil.parse(content), "record", "", RuleEngine.Request.of(RuleScope.SAVE));
            assertThat(french.findings().get(0).message()).isEqualTo("News need a teaser");
        }
    }

    @Nested
    class Builtins {

        @Test
        @DisplayName("a definition without rules yields exactly the ContentValidator's findings")
        void withoutRulesTheBuiltinsAreUnchanged() {
            ContentDefinition plain = definition("""
                    content {
                      editor text title { required maxLength 5 }
                      editor number count { min 1 }
                      editor select pick { options [ { value "a" label "A" } ] }
                    }
                    """);
            String content = "{\"count\":0,\"pick\":\"z\"}";
            List<ContentIssue> direct = new ContentValidator().validate(plain, JsonUtil.parse(content));
            RuleOutcome edit = run(plain, content, RuleScope.EDIT);
            assertThat(edit.findings()).isEqualTo(direct);
            assertThat(edit.findings()).extracting(ContentIssue::code).containsExactly("required", "min", "option");
            RuleOutcome save = run(plain, content, RuleScope.SAVE);
            assertThat(save.findings()).as("completeness built-ins aren't save rules; structural ones are everywhere")
                    .extracting(ContentIssue::code).containsExactly("option");
        }

        @Test
        void inlineOverridesSetSeverityScopeAndMessage() {
            ContentDefinition def = definition("""
                    content {
                      editor text title { required level warning scope [release] message { en "Give it a title" } }
                      editor text code { validate pattern "^[A-Z]+$" message "Upper case only" level info }
                      editor text summary { maxLength 3 scope [save] message { en "{length} of {max}" } }
                    }
                    """);
            String content = "{\"code\":\"abc\",\"summary\":\"12345\"}";
            RuleOutcome edit = run(def, content, RuleScope.EDIT);
            assertThat(edit.findings()).extracting(ContentIssue::code).containsExactly("pattern");
            assertThat(edit.findings().get(0).severity()).isEqualTo(Severity.INFO);
            assertThat(edit.findings().get(0).message()).isEqualTo("Upper case only");

            RuleOutcome release = run(def, content, RuleScope.RELEASE);
            assertThat(release.findings()).extracting(ContentIssue::code).containsExactly("required", "pattern");
            assertThat(release.findings().get(0).severity()).isEqualTo(Severity.WARNING);
            assertThat(release.findings().get(0).message()).isEqualTo("Give it a title");
            assertThat(release.blocks(RuleScope.RELEASE)).isFalse();

            RuleOutcome save = run(def, content, RuleScope.SAVE);
            assertThat(save.findings()).extracting(ContentIssue::message).containsExactly("5 of 3");
            assertThat(save.blocks(RuleScope.SAVE)).as("an error in the save scope").isTrue();
        }
    }

    @Nested
    class Rows {

        private final ContentDefinition gallery = definition("""
                content {
                  editor list gallery {
                    item {
                      editor text caption { label "Caption" }
                      editor list tags { item { editor text name { label "Tag" } } }
                    }
                  }
                }
                rules {
                  rule "caption" on gallery[] { level error scope [release] assert "!isEmpty(item.caption)" message { en "Image {index} needs a caption" } }
                  rule "tag-length" on gallery[].tags[].name { level warning scope [release] assert "length(value) <= 3 or parent.caption == 'long'"
                    message { en "Tag {index} is long: {value}" } }
                }
                """);

        @Test
        void rulesRunPerRowWithItemIndexAndParent() {
            RuleOutcome outcome = run(gallery, """
                    {"gallery":[
                      {"caption":"One","tags":[{"name":"ok"},{"name":"toolong"}]},
                      {"caption":"","tags":[]},
                      {"caption":"long","tags":[{"name":"toolong"}]}
                    ]}""", RuleScope.RELEASE);
            assertThat(outcome.findings()).extracting(ContentIssue::path, ContentIssue::message).containsExactly(
                    org.assertj.core.groups.Tuple.tuple("gallery[1]", "Image 2 needs a caption"),
                    org.assertj.core.groups.Tuple.tuple("gallery[0].tags[1].name", "Tag 2 is long: toolong"));
        }
    }

    @Nested
    class Locales {

        private final ContentDefinition localized = definition("""
                content {
                  editor text title { localizable }
                  editor text sku { }
                }
                rules {
                  rule "title-length" on title { level warning scope [edit] assert "length(value) <= 5" message { en "{locale}: too long" } }
                  rule "default-only" on title { level info scope [edit] locales [default] assert "false" message { en "default {locale}" } }
                  rule "sku-set" on sku { level info scope [edit] assert "!isEmpty(value)" message { en "SKU" } }
                }
                """);

        @Test
        void languageDependentRulesRunPerLocaleOthersOnce() {
            RuleOutcome outcome = engine(DE_EN, null).evaluate(localized,
                    JsonUtil.parse("{\"title\":{\"type\":\"L10N\",\"values\":{\"de\":\"Überschrift\",\"en\":\"Head\"}}}"),
                    "record", "", RuleEngine.Request.of(RuleScope.EDIT));
            assertThat(outcome.findings()).extracting(ContentIssue::rule, ContentIssue::locale, ContentIssue::message)
                    .containsExactly(
                            org.assertj.core.groups.Tuple.tuple("title-length", "de", "de: too long"),
                            org.assertj.core.groups.Tuple.tuple("default-only", "de", "default de"),
                            org.assertj.core.groups.Tuple.tuple("sku-set", null, "SKU"));
        }

        @Test
        void anEnglishValueFallsBackThroughItsChain() {
            RuleOutcome outcome = engine(DE_EN, null).evaluate(localized,
                    JsonUtil.parse("{\"title\":{\"type\":\"L10N\",\"values\":{\"de\":\"Überschrift\"}},\"sku\":\"1\"}"),
                    "record", "", new RuleEngine.Request(RuleScope.EDIT, List.of("en"), RuleContextProvider.NONE));
            assertThat(outcome.findings()).extracting(ContentIssue::rule, ContentIssue::locale)
                    .containsExactly(org.assertj.core.groups.Tuple.tuple("title-length", "en"));
        }
    }

    @Nested
    class Fills {

        private final ContentDefinition def = definition("""
                content {
                  editor text title { }
                  editor text slug { }
                  editor text path { }
                  editor text stamp { }
                }
                rules {
                  fill path { value "'/news/' + slug" mode always on [save] }
                  fill slug { value "slugify(title)" mode empty on [edit, save] }
                  fill stamp { value "today()" mode empty on [release] }
                  rule "path-set" on path { level error scope [save] assert "!isEmpty(value)" message { en "path" } }
                }
                """);

        @Test
        @DisplayName("fills run in dependency order and assertions see the filled values")
        void fillsInDependencyOrder() {
            RuleOutcome outcome = run(def, "{\"title\":\"Über uns\"}", RuleScope.SAVE);
            assertThat(outcome.findings()).isEmpty();
            assertThat(outcome.content().get("slug").asText()).isEqualTo("uber-uns");
            assertThat(outcome.content().get("path").asText()).isEqualTo("/news/uber-uns");
            assertThat(outcome.fills()).extracting(RuleFill::path, RuleFill::mode).containsExactly(
                    org.assertj.core.groups.Tuple.tuple("slug", FillMode.EMPTY),
                    org.assertj.core.groups.Tuple.tuple("path", FillMode.ALWAYS));
            assertThat(outcome.fieldStates()).containsExactly(new FieldState("path", null, false, true, true));
        }

        @Test
        void emptyModeKeepsAValueAlwaysOverwrites() {
            RuleOutcome outcome = run(def, "{\"title\":\"Über uns\",\"slug\":\"custom\",\"path\":\"typed\"}", RuleScope.SAVE);
            assertThat(outcome.content().get("slug").asText()).isEqualTo("custom");
            assertThat(outcome.content().get("path").asText()).isEqualTo("/news/custom");
            assertThat(outcome.fills()).extracting(RuleFill::path).containsExactly("path");
        }

        @Test
        void fillsRunOnlyInTheirScopes() {
            RuleOutcome edit = run(def, "{\"title\":\"A B\"}", RuleScope.EDIT);
            assertThat(edit.fills()).extracting(RuleFill::path).containsExactly("slug");
            RuleProvider clock = new RuleProvider();
            RuleOutcome release = engine().evaluate(def, JsonUtil.parse("{}"), "record", "",
                    new RuleEngine.Request(RuleScope.RELEASE, null, clock));
            assertThat(release.content().get("stamp").asText()).as("dates are stored as ISO text").isEqualTo("2026-09-30");
        }

        @Test
        void localizedFillsWriteEachLanguage() {
            ContentDefinition localized = definition("""
                    content { editor text title { localizable } editor text slug { localizable } }
                    rules { fill slug { value "slugify(title)" on [save] } }
                    """);
            RuleOutcome outcome = engine(DE_EN, null).evaluate(localized,
                    JsonUtil.parse("{\"title\":{\"type\":\"L10N\",\"values\":{\"de\":\"Über uns\",\"en\":\"About us\"}},"
                            + "\"slug\":{\"type\":\"L10N\",\"values\":{\"en\":\"kept\"}}}"),
                    "record", "", RuleEngine.Request.of(RuleScope.SAVE));
            assertThat(outcome.content().at("/slug/values/de").asText()).isEqualTo("uber-uns");
            assertThat(outcome.content().at("/slug/values/en").asText()).isEqualTo("kept");
            assertThat(outcome.fills()).extracting(RuleFill::locale).containsExactly("de");
        }
    }

    @Nested
    class States {

        private final ContentDefinition def = definition("""
                content {
                  editor select category { options [ { value "news" label "News" }, { value "page" label "Page" } ] }
                  editor text teaser { }
                  editor text frozen { }
                }
                rules {
                  state teaser { requiredWhen "category == 'news'" }
                  state frozen { readOnlyWhen "category == 'page'" level warning }
                }
                """);

        @Test
        void requiredWhenAddsARequiredFindingInTheBuiltinScopes() {
            RuleOutcome edit = run(def, "{\"category\":\"news\"}", RuleScope.EDIT);
            assertThat(edit.findings()).extracting(ContentIssue::code, ContentIssue::path, ContentIssue::severity)
                    .containsExactly(org.assertj.core.groups.Tuple.tuple("required", "teaser", Severity.ERROR));
            assertThat(edit.fieldStates()).contains(new FieldState("teaser", null, true, false));
            assertThat(run(def, "{\"category\":\"news\"}", RuleScope.SAVE).findings())
                    .as("the required built-in's scopes: not save")
                    .isEmpty();
            assertThat(run(def, "{\"category\":\"page\"}", RuleScope.EDIT).findings()).isEmpty();
        }

        @Test
        void readOnlyWhenIsAFieldState() {
            RuleOutcome edit = run(def, "{\"category\":\"page\",\"frozen\":\"x\"}", RuleScope.EDIT);
            assertThat(edit.fieldStates()).contains(new FieldState("frozen", null, false, true));
        }
    }

    @Nested
    class Visibility {

        @Test
        void editorsHiddenByVisibleWhenAreSkipped() {
            ContentDefinition def = definition("""
                    content {
                      editor boolean hasCta { }
                      editor text cta { visibleWhen "hasCta == true" }
                    }
                    rules {
                      rule "cta" on cta { level error scope [edit] assert "!isEmpty(value)" message { en "CTA" } }
                      fill cta { value "'Read more'" on [edit] }
                    }
                    """);
            RuleOutcome hidden = run(def, "{\"hasCta\":false}", RuleScope.EDIT);
            assertThat(hidden.findings()).isEmpty();
            assertThat(hidden.fills()).isEmpty();
            RuleOutcome shown = run(def, "{\"hasCta\":true}", RuleScope.EDIT);
            assertThat(shown.fills()).extracting(RuleFill::path).containsExactly("cta");
        }
    }

    @Nested
    class PagesAndSections {

        private final ContentDefinition page = definition("""
                content { editor text title { } }
                bodies { body main { } }
                rules {
                  rule "one-hero" on page { level error scope [release] assert "count(sections(body.main, 'hero')) == 1"
                    message { en "Exactly one hero" } }
                }
                """);

        private final ContentDefinition hero = definition("""
                content { editor text headline { } }
                rules {
                  rule "headline-differs" on headline { level warning scope [release] assert "value != section.page.title"
                    message { en "Don't repeat the page title" } }
                  fill headline { value "section.page.title + '!'" on [save] }
                }
                """);

        private final UUID heroUuid = UUID.randomUUID();

        private final SectionTemplateLookup sections = ref -> ref.equals(heroUuid.toString())
                ? Optional.of(new SectionTemplateLookup.SectionTemplate("hero", hero))
                : Optional.empty();

        private JsonNode payload(int heroes, String headline) {
            StringBuilder body = new StringBuilder();
            for (int i = 0; i < heroes; i++) {
                body.append(i == 0 ? "" : ",").append("{\"instanceId\":\"s").append(i).append("\",\"templateRef\":\"")
                        .append(heroUuid).append("\",\"content\":{").append(headline == null ? "" : "\"headline\":\"" + headline + "\"").append("}}");
            }
            return JsonUtil.parse("{\"content\":{\"title\":\"Hello\"},\"bodies\":{\"main\":[" + body + "]}}");
        }

        @Test
        void pageRulesSeeBodiesAndSectionRulesSeeThePage() {
            RuleOutcome none = engine().evaluatePage(page, payload(0, null), sections, RuleEngine.Request.of(RuleScope.RELEASE));
            assertThat(none.findings()).extracting(ContentIssue::rule, ContentIssue::path)
                    .containsExactly(org.assertj.core.groups.Tuple.tuple("one-hero", ""));
            RuleOutcome repeated = engine().evaluatePage(page, payload(1, "Hello"), sections, RuleEngine.Request.of(RuleScope.RELEASE));
            assertThat(repeated.findings()).extracting(ContentIssue::rule, ContentIssue::path)
                    .containsExactly(org.assertj.core.groups.Tuple.tuple("headline-differs", "bodies.main[0].content.headline"));
        }

        @Test
        void sectionFillsWriteIntoThePayload() {
            RuleOutcome saved = engine().evaluatePage(page, payload(1, null), sections, RuleEngine.Request.of(RuleScope.SAVE));
            assertThat(saved.content().at("/bodies/main/0/content/headline").asText()).isEqualTo("Hello!");
            assertThat(saved.fills()).extracting(RuleFill::path).containsExactly("bodies.main[0].content.headline");
        }
    }

    @Nested
    class ReferencesAndLimits {

        private final ContentDefinition def = definition("""
                content { editor media image { } editor list images { item { editor media file { } } } }
                rules {
                  rule "alt" on image { level warning scope [edit] assert "!isEmpty(ref(value).meta.alt)" message { en "No alt text" } }
                  rule "many" on images[] { level info scope [release] assert "ref(item.file) != null" message { en "x" } }
                  rule "broken" on image { level error scope [edit] assert "1 / 0 > 1" message { en "never" } }
                }
                """);

        @Test
        void refResolvesThroughTheProviderAndRecordsTheTarget() {
            UUID media = UUID.randomUUID();
            RuleProvider provider = new RuleProvider();
            provider.alt = "";
            RuleOutcome outcome = engine().evaluate(def,
                    JsonUtil.parse("{\"image\":{\"type\":\"MEDIA_REF\",\"uuid\":\"" + media + "\"}}"), "record", "",
                    new RuleEngine.Request(RuleScope.EDIT, null, provider));
            assertThat(outcome.findings()).extracting(ContentIssue::rule, ContentIssue::code)
                    .containsExactly(
                            org.assertj.core.groups.Tuple.tuple("alt", RuleEngine.CODE_RULE),
                            org.assertj.core.groups.Tuple.tuple("broken", RuleEngine.CODE_EVAL));
            assertThat(outcome.findings().get(1).severity()).as("an evaluation error warns and passes").isEqualTo(Severity.WARNING);
            assertThat(outcome.refTargets()).containsExactly(media);
            assertThat(provider.refLocales).containsExactly((String) null);
        }

        @Test
        void moreThan200RefsIsARuleEvalWarning() {
            StringBuilder rows = new StringBuilder();
            for (int i = 0; i < 205; i++) {
                rows.append(i == 0 ? "" : ",").append("{\"file\":{\"type\":\"MEDIA_REF\",\"uuid\":\"").append(UUID.randomUUID()).append("\"}}");
            }
            RuleOutcome outcome = engine().evaluate(def, JsonUtil.parse("{\"images\":[" + rows + "]}"), "record", "",
                    new RuleEngine.Request(RuleScope.RELEASE, null, new RuleProvider()));
            assertThat(outcome.findings()).extracting(ContentIssue::code).containsOnly(RuleEngine.CODE_EVAL);
            assertThat(outcome.findings()).hasSize(5);
            assertThat(outcome.refTargets()).hasSize(200);
        }
    }

    @Test
    @DisplayName("benchmark: 10 rules × 3 languages evaluate in a few milliseconds when warm")
    void tenRulesThreeLocalesAreFast() {
        StringBuilder rules = new StringBuilder("rules {\n");
        for (int i = 0; i < 10; i++) {
            rules.append("rule \"r").append(i).append("\" on title { level warning scope [edit] assert \"length(value) <= ")
                    .append(50 + i).append(" and !matches(value, '^x')\" message { en \"m\" } }\n");
        }
        rules.append("}");
        ContentDefinition def = definition("content { editor text title { localizable } editor text body { localizable } }" + rules);
        LocalizationContext three = new LocalizationContext(true, "de", List.of("de", "en", "fr"));
        RuleEngine engine = engine(three, null);
        JsonNode content = JsonUtil.parse("{\"title\":{\"type\":\"L10N\",\"values\":{\"de\":\"Titel\",\"en\":\"Title\",\"fr\":\"Titre\"}}}");
        for (int i = 0; i < 2_000; i++) {
            engine.evaluate(def, content, "record", "", RuleEngine.Request.of(RuleScope.EDIT));
        }
        List<Long> times = new ArrayList<>();
        for (int i = 0; i < 200; i++) {
            long start = System.nanoTime();
            engine.evaluate(def, content, "record", "", RuleEngine.Request.of(RuleScope.EDIT));
            times.add(System.nanoTime() - start);
        }
        times.sort(Long::compare);
        long medianMicros = times.get(times.size() / 2) / 1_000;
        System.out.println("RuleEngine: 10 rules x 3 locales, median " + medianMicros + " µs");
        assertThat(medianMicros).as("median %d µs", medianMicros).isLessThan(5_000);
    }

    /** A provider with a fixed clock (2026-09-30), an image alt text and the locales ref was asked for. */
    private static final class RuleProvider implements RuleContextProvider {
        String alt = "A dog";
        final List<String> refLocales = new ArrayList<>();

        @Override
        public Clock clock() {
            return Clock.fixed(Instant.parse("2026-09-30T08:00:00Z"), ZoneOffset.UTC);
        }

        @Override
        public JsonNode ref(JsonNode value, String locale) {
            refLocales.add(locale);
            return JsonUtil.parse("{\"meta\":{\"alt\":\"" + alt + "\"}}");
        }

        @Override
        public JsonNode meta() {
            return JsonUtil.parse("{\"uid\":\"r\"}");
        }
    }
}
