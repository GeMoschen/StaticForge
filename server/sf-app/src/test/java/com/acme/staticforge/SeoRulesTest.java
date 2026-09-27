package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.QualityRuleConfig;
import com.acme.staticforge.generate.quality.QualityRuleRegistry;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.rules.OutputNotCheckedRule;
import com.acme.staticforge.generate.quality.rules.seo.CanonicalRule;
import com.acme.staticforge.generate.quality.rules.seo.DescriptionLengthRule;
import com.acme.staticforge.generate.quality.rules.seo.DuplicateDescriptionRule;
import com.acme.staticforge.generate.quality.rules.seo.DuplicateTitleRule;
import com.acme.staticforge.generate.quality.rules.seo.HreflangRule;
import com.acme.staticforge.generate.quality.rules.seo.LangMismatchRule;
import com.acme.staticforge.generate.quality.rules.seo.MissingDescriptionRule;
import com.acme.staticforge.generate.quality.rules.seo.MissingH1Rule;
import com.acme.staticforge.generate.quality.rules.seo.MissingTitleRule;
import com.acme.staticforge.generate.quality.rules.seo.MultipleH1Rule;
import com.acme.staticforge.generate.quality.rules.seo.NoIndexRobotsRule;
import com.acme.staticforge.generate.quality.rules.seo.TitleLengthRule;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The SEO rules {@code SF-CHK-0201}–{@code 0212} over the fixtures in {@code quality/seo/} (M30.2.2). */
class SeoRulesTest {

    /** de, en and de-CH, which falls back to de. */
    static final LocaleConfig LOCALES = LocaleConfig.of(
            List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"),
                    new ProjectLocale("de-CH", "Deutsch (Schweiz)")),
            "de",
            Map.of("de-CH", List.of("de")),
            false);

    private static final UUID ABOUT = UUID.randomUUID();
    private static final UUID NEWS = UUID.randomUUID();
    private static final UUID CONTACT = UUID.randomUUID();

    private static OutputKey key(String path, UUID asset, String locale) {
        return new OutputKey(path, asset, "html", locale, null);
    }

    private static List<String> messages(List<Finding> findings) {
        return findings.stream().map(Finding::message).toList();
    }

    @Test
    void everyRuleIsRegisteredWithTheCatalogueCodes() {
        QualityRuleRegistry registry = new QualityRuleRegistry(List.of(new MissingTitleRule(), new TitleLengthRule(),
                new MissingDescriptionRule(), new DescriptionLengthRule(), new DuplicateTitleRule(),
                new DuplicateDescriptionRule(), new MissingH1Rule(), new MultipleH1Rule(), new LangMismatchRule(),
                new HreflangRule(), new CanonicalRule(), new NoIndexRobotsRule(), new OutputNotCheckedRule()));

        assertThat(registry.codes()).contains("SF-CHK-0201", "SF-CHK-0202", "SF-CHK-0203", "SF-CHK-0204", "SF-CHK-0205",
                "SF-CHK-0206", "SF-CHK-0207", "SF-CHK-0208", "SF-CHK-0209", "SF-CHK-0210", "SF-CHK-0211", "SF-CHK-0212");
        assertThat(registry.siteRules()).extracting(rule -> rule.code())
                .containsExactly("SF-CHK-0205", "SF-CHK-0206", "SF-CHK-0210", "SF-CHK-0211");
        // Only the alternates rule reads the held-back set: it alone is capped at WARNING.
        assertThat(new HreflangRule().maxSeverity()).isEqualTo(QualitySeverity.WARNING);
        assertThat(new CanonicalRule().maxSeverity()).isEqualTo(QualitySeverity.ERROR);
    }

    @Nested
    class Title {

        @Test
        void missingEmptyOrOnlyInsideSvg() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new MissingTitleRule())
                    .pageFromFixture("missing.html", "seo/0201-fail-missing.html")
                    .pageFromFixture("empty.html", "seo/0201-fail-empty.html")
                    .pageFromFixture("svg.html", "seo/0201-fail-svg-only.html")
                    .pageFromFixture("ok.html", "seo/0201-pass.html")
                    .run();

            assertThat(result.of("SF-CHK-0201"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("missing.html", null, "The page has no <title>."),
                            tuple("empty.html", "head > title", "The <title> is empty."),
                            tuple("svg.html", null, "The page has no <title>."));
        }

        @Test
        void lengthIsCountedInCodePointsOfTheNormalizedText() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new TitleLengthRule())
                    .pageFromFixture("short.html", "seo/0202-fail-short.html")
                    .pageFromFixture("long.html", "seo/0202-fail-long.html")
                    .pageFromFixture("ok.html", "seo/0201-pass.html")
                    .pageFromFixture("none.html", "seo/0201-fail-missing.html")
                    .run();

            assertThat(result.of("SF-CHK-0202"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("short.html", "head > title",
                                    "Title \"Home\" is too short: 4 characters, at least 10 recommended."),
                            tuple("long.html", "head > title", "Title \"A very long title that keeps going well "
                                    + "past the sixty characters a result shows\" is too long: 80 characters, at most 60 "
                                    + "recommended."));

            // "Café 🍰 à la carte": 17 code points (18 UTF-16 units), whitespace collapsed.
            QualityRuleHarness exact = QualityRuleHarness.of(new TitleLengthRule())
                    .pageFromFixture("emoji.html", "seo/0202-pass-code-points.html");
            assertThat(exact.configure("SF-CHK-0202", QualitySeverity.WARNING, Map.of("min", 17, "max", 17))
                            .run().of("SF-CHK-0202"))
                    .isEmpty();
            assertThat(exact.configure("SF-CHK-0202", QualitySeverity.WARNING, Map.of("min", 18, "max", 30))
                            .run().of("SF-CHK-0202"))
                    .extracting(Finding::message)
                    .containsExactly("Title \"Café 🍰 à la carte\" is too short: 17 characters, at least 18 recommended.");
        }

        @Test
        void aRangeWhoseMinExceedsItsMaxIsRejected() {
            QualityRuleRegistry registry = new QualityRuleRegistry(List.of(new TitleLengthRule(), new DescriptionLengthRule()));

            QualityRuleConfig.Validation validation = QualityRuleConfig.validate(registry, Map.of(
                    "SF-CHK-0202", new QualityRuleConfig.Entry("WARNING", Map.of("min", 70)),
                    "SF-CHK-0204", new QualityRuleConfig.Entry("WARNING", Map.of("min", 60, "max", 120))));

            assertThat(validation.errors()).containsExactly("SF-CHK-0202: min (70) must not be greater than max (60).");
            assertThat(validation.settings()).containsOnlyKeys("SF-CHK-0204");
        }
    }

    @Nested
    class Description {

        @Test
        void missingOrEmpty() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new MissingDescriptionRule())
                    .pageFromFixture("missing.html", "seo/0203-fail-missing.html")
                    .pageFromFixture("empty.html", "seo/0203-fail-empty.html")
                    .pageFromFixture("ok.html", "seo/0203-pass.html")
                    .run();

            assertThat(result.of("SF-CHK-0203"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("missing.html", null, "The page has no meta description."),
                            tuple("empty.html", "head > meta:nth-of-type(2)", "The meta description is empty."));
        }

        @Test
        void length() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new DescriptionLengthRule())
                    .pageFromFixture("short.html", "seo/0204-fail-short.html")
                    .pageFromFixture("long.html", "seo/0204-fail-long.html")
                    .pageFromFixture("ok.html", "seo/0204-pass-whitespace.html")
                    .pageFromFixture("none.html", "seo/0203-fail-missing.html")
                    .run();

            assertThat(result.of("SF-CHK-0204")).extracting(f -> f.output().path()).containsExactly("short.html", "long.html");
            assertThat(messages(result.of("SF-CHK-0204"))).containsExactly(
                    "Meta description \"Too short.\" is too short: 10 characters, at least 50 recommended.",
                    "Meta description \"" + "A description that goes on and on. ".repeat(6).strip()
                            + "\" is too long: 209 characters, at most 160 recommended.");
        }
    }

    @Nested
    class Duplicates {

        @Test
        void everyMemberNamesTheOthers() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new DuplicateTitleRule(), new DuplicateDescriptionRule())
                    .pageFromFixture("b.html", "seo/0205-dup-b.html")
                    .pageFromFixture("a.html", "seo/0205-dup-a.html")
                    .pageFromFixture("c.html", "seo/0205-other.html")
                    .pageFromFixture("d1.html", "seo/0206-dup-a.html")
                    .pageFromFixture("d2.html", "seo/0206-dup-b.html")
                    .run();

            assertThat(result.of("SF-CHK-0205"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("a.html", null, "Title \"Our products and services\" is also used by b.html."),
                            tuple("b.html", null, "Title \"Our products and services\" is also used by a.html."));
            assertThat(result.of("SF-CHK-0206"))
                    .extracting(f -> f.output().path(), Finding::message)
                    .containsExactly(
                            tuple("d1.html", "Meta description \"One description shared by more than one page of this "
                                    + "site.\" is also used by d2.html."),
                            tuple("d2.html", "Meta description \"One description shared by more than one page of this "
                                    + "site.\" is also used by d1.html."));
        }

        @Test
        void aLargeGroupNamesTenOthersAndCountsTheRest() {
            QualityRuleHarness harness = QualityRuleHarness.of(new DuplicateTitleRule());
            for (int i = 10; i < 22; i++) {
                harness.pageFromFixture("p" + i + ".html", "seo/0205-dup-a.html");
            }

            List<Finding> findings = harness.run().of("SF-CHK-0205");

            assertThat(findings).hasSize(12);
            assertThat(findings.get(0).message()).isEqualTo("Title \"Our products and services\" is also used by "
                    + "p11.html, p12.html, p13.html, p14.html, p15.html, p16.html, p17.html, p18.html, p19.html, "
                    + "p20.html and 1 more.");
        }

        @Test
        void neverAcrossChannelsOrLanguagesAndNotForNoIndexPages() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new DuplicateTitleRule(), new DuplicateDescriptionRule())
                    .locales(LOCALES)
                    .page(key("de/a.html", ABOUT, "de"), QualityRuleHarness.fixture("seo/0205-dup-a.html"))
                    .page(key("en/a.html", ABOUT, "en"), QualityRuleHarness.fixture("seo/0205-dup-a.html"))
                    .page(new OutputKey("amp/de/a.html", ABOUT, "amp", "de", null),
                            QualityRuleHarness.fixture("seo/0205-dup-b.html"))
                    .page(key("de/hidden.html", NEWS, "de"), QualityRuleHarness.fixture("seo/0205-dup-b.html"))
                    .noIndex("de/hidden.html")
                    .page(key("de/d1.html", CONTACT, "de"), QualityRuleHarness.fixture("seo/0206-dup-a.html"))
                    .page(key("de-ch/d1.html", CONTACT, "de-CH"), QualityRuleHarness.fixture("seo/0206-dup-b.html"))
                    .page(new OutputKey("amp/de/d1.html", CONTACT, "amp", "de", null),
                            QualityRuleHarness.fixture("seo/0206-dup-b.html"))
                    .run();

            assertThat(result.of("SF-CHK-0205")).isEmpty();
            assertThat(result.of("SF-CHK-0206")).isEmpty();
        }

        /**
         * Every page number of a paginated page is its own URL: page numbers that share a title (or description) are
         * duplicates for search engines and are reported (decision recorded in the feature README; the rule
         * descriptions name the fix, {@code $CMS_META(pageNumber)$}).
         */
        @Test
        void thePageNumbersOfOnePaginatedPageThatShareATitleAreDuplicates() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new DuplicateTitleRule(), new DuplicateDescriptionRule())
                    .locales(LOCALES)
                    .page(new OutputKey("de/news.html", NEWS, "html", "de", 1),
                            QualityRuleHarness.fixture("seo/0205-dup-a.html"))
                    .page(new OutputKey("de/news-2.html", NEWS, "html", "de", 2),
                            QualityRuleHarness.fixture("seo/0205-dup-a.html"))
                    .run();

            assertThat(result.of("SF-CHK-0205"))
                    .extracting(f -> f.output().path(), Finding::message)
                    .containsExactly(
                            tuple("de/news-2.html", "Title \"Our products and services\" is also used by de/news.html."),
                            tuple("de/news.html", "Title \"Our products and services\" is also used by de/news-2.html."));
            assertThat(result.of("SF-CHK-0206")).extracting(f -> f.output().path())
                    .containsExactly("de/news-2.html", "de/news.html");
        }
    }

    @Nested
    class Headings {

        @Test
        void noH1() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new MissingH1Rule())
                    .pageFromFixture("none.html", "seo/0207-fail.html")
                    .pageFromFixture("ok.html", "seo/0207-pass.html")
                    .pageFromFixture("many.html", "seo/0208-fail.html")
                    .run();

            assertThat(result.of("SF-CHK-0207"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(tuple("none.html", null, "The page has no h1 heading."));
        }

        @Test
        void everyH1AfterTheFirstIsReported() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new MultipleH1Rule())
                    .pageFromFixture("many.html", "seo/0208-fail.html")
                    .pageFromFixture("one.html", "seo/0208-pass.html")
                    .pageFromFixture("none.html", "seo/0207-fail.html")
                    .run();

            assertThat(result.of("SF-CHK-0208"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("many.html", "body > section:nth-of-type(1) > h1", "h1 heading 2 of 3: a page should have one."),
                            tuple("many.html", "body > section:nth-of-type(2) > h1", "h1 heading 3 of 3: a page should have one."));
        }
    }

    @Nested
    class Lang {

        @Test
        void thePrimarySubtagMustBeTheRenderLanguage() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new LangMismatchRule())
                    .locales(LOCALES)
                    .page(key("de/wrong.html", ABOUT, "de"), QualityRuleHarness.fixture("seo/0209-fail.html"))
                    .page(key("de/ok.html", NEWS, "de"), QualityRuleHarness.fixture("seo/0209-pass-de.html"))
                    // A de-CH output rendered from the de fallback: "de" and "de-CH" both fit, "en" doesn't.
                    .page(key("de-ch/ok.html", NEWS, "de-CH"), QualityRuleHarness.fixture("seo/0209-pass-de.html"))
                    .page(key("de-ch/full.html", CONTACT, "de-CH"), QualityRuleHarness.fixture("seo/0209-pass-de-ch.html"))
                    .page(key("de-ch/wrong.html", ABOUT, "de-CH"), QualityRuleHarness.fixture("seo/0209-fail.html"))
                    .page(key("en/ok.html", NEWS, "en"), QualityRuleHarness.fixture("seo/0209-fail.html"))
                    // No lang at all is SF-CHK-0308's finding.
                    .page(key("en/none.html", CONTACT, "en"), QualityRuleHarness.fixture("seo/0209-pass-no-lang.html"))
                    .run();

            assertThat(result.of("SF-CHK-0209"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("de/wrong.html", "html",
                                    "<html lang=\"en\"> doesn't match the page's language de: expected \"de\" or a tag "
                                            + "starting with it."),
                            tuple("de-ch/wrong.html", "html",
                                    "<html lang=\"en\"> doesn't match the page's language de-CH: expected \"de\" or a "
                                            + "tag starting with it."));
        }

        @Test
        void aProjectWithoutLanguagesIsSkipped() {
            assertThat(QualityRuleHarness.of(new LangMismatchRule())
                            .pageFromFixture("index.html", "seo/0209-fail.html")
                            .run()
                            .of("SF-CHK-0209"))
                    .isEmpty();
        }
    }

    @Nested
    class Alternates {

        /** "about" published in de, en and de-CH (a fallback render of de), each output given its fixture. */
        private QualityRuleHarness about(String de, String en, String deCh) {
            return QualityRuleHarness.of(new HreflangRule())
                    .locales(LOCALES)
                    .page(key("de/about.html", ABOUT, "de"), QualityRuleHarness.fixture("seo/" + de))
                    .page(key("en/about.html", ABOUT, "en"), QualityRuleHarness.fixture("seo/" + en))
                    .page(key("de-ch/about.html", ABOUT, "de-CH"), QualityRuleHarness.fixture("seo/" + deCh));
        }

        @Test
        void completeReciprocalAlternatesPass() {
            assertThat(about("0210-pass-de.html", "0210-pass-en.html", "0210-pass-de-ch.html").run().of("SF-CHK-0210"))
                    .isEmpty();
        }

        @Test
        void aPaginatedPagesLaterPagesMayPointAtPageOne() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new HreflangRule())
                    .locales(LOCALES)
                    .page(new OutputKey("de/news.html", NEWS, "html", "de", 1),
                            QualityRuleHarness.fixture("seo/0210-pass-page1-de.html"))
                    .page(new OutputKey("de/news-2.html", NEWS, "html", "de", 2),
                            QualityRuleHarness.fixture("seo/0210-pass-page2-de.html"))
                    .page(new OutputKey("en/news.html", NEWS, "html", "en", 1),
                            QualityRuleHarness.fixture("seo/0210-pass-page1-en.html"))
                    .run();

            assertThat(result.of("SF-CHK-0210")).isEmpty();
        }

        @Test
        void aLanguageTheAlternatesLeaveOutIsReported() {
            List<Finding> findings =
                    about("0210-fail-incomplete-de.html", "0210-pass-en.html", "0210-pass-de-ch.html").run().of("SF-CHK-0210");

            assertThat(findings)
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            // de-CH's alternate to de isn't answered either: de doesn't name de-CH.
                            tuple("de-ch/about.html", "head > link:nth-of-type(1)",
                                    "hreflang \"de\" points at de/about.html, which doesn't name de-CH back."),
                            tuple("de/about.html", null,
                                    "The hreflang alternates don't name de-CH, in which the page is published."));
        }

        @Test
        void anAlternateThatIsNotAnsweredIsReported() {
            List<Finding> findings =
                    about("0210-pass-de.html", "0210-fail-not-reciprocal-en.html", "0210-pass-de-ch.html").run().of("SF-CHK-0210");

            assertThat(findings)
                    .extracting(f -> f.output().path(), Finding::message)
                    .containsExactly(
                            tuple("de/about.html",
                                    "hreflang \"en\" points at en/about.html, which doesn't name de back."),
                            tuple("en/about.html", "The hreflang alternates don't name de, in which the page is published."));
        }

        @Test
        void unreleasedAndHeldBackLanguagesAreReported() {
            // fr: the page isn't released in French (no output); de-CH: held back in this build.
            QualityRuleHarness.Result result = QualityRuleHarness.of(new HreflangRule())
                    .locales(LocaleConfig.of(
                            List.of(new ProjectLocale("de", "Deutsch"), new ProjectLocale("en", "English"),
                                    new ProjectLocale("de-CH", "Schweiz"), new ProjectLocale("fr", "Français"),
                                    new ProjectLocale("it", "Italiano")),
                            "de", Map.of("de-CH", List.of("de")), false))
                    .page(key("de/about.html", ABOUT, "de"), QualityRuleHarness.fixture("seo/0210-fail-unreleased-de.html"))
                    .page(key("en/about.html", ABOUT, "en"), QualityRuleHarness.fixture("seo/0210-pass-en.html"))
                    .heldBack("de-ch/about.html")
                    .run();

            assertThat(result.of("SF-CHK-0210"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("de/about.html", "head > link:nth-of-type(3)",
                                    "hreflang \"de-CH\" points at de-ch/about.html, which is held back in this build."),
                            tuple("de/about.html", "head > link:nth-of-type(4)",
                                    "hreflang \"fr\" points at fr/about.html, which is not an output of this build."),
                            tuple("de/about.html", "head > link:nth-of-type(5)",
                                    "hreflang \"it\" names it, in which the page is not published."),
                            tuple("en/about.html", "head > link:nth-of-type(3)",
                                    "hreflang \"de-CH\" points at de-ch/about.html, which is held back in this build."));
            assertThat(result.of("SF-CHK-0210")).allMatch(f -> f.severity() == QualitySeverity.WARNING);
        }

        @Test
        void anAlternateToAnotherPageOrUnderTheWrongLanguageIsReported() {
            List<Finding> findings = about("0210-fail-wrong-target-de.html", "0210-pass-en.html", "0210-pass-de-ch.html")
                    .page(key("en/contact.html", CONTACT, "en"), QualityRuleHarness.fixture("seo/0207-pass.html"))
                    .run()
                    .of("SF-CHK-0210");

            assertThat(findings)
                    .extracting(f -> f.output().path(), Finding::message)
                    .containsExactly(
                            tuple("de/about.html", "hreflang \"en\" points at en/contact.html, which is not an output "
                                    + "of this page."),
                            tuple("de/about.html", "hreflang \"fr\" points at en/about.html, the page's en output."));
        }

        @Test
        void noAlternatesAreFineUnlessThePageIsPublishedInSeveralLanguages() {
            List<Finding> several = about("0210-fail-none-de.html", "0210-pass-en.html", "0210-pass-de-ch.html")
                    .run().of("SF-CHK-0210");
            assertThat(several)
                    .extracting(f -> f.output().path(), Finding::message)
                    .containsExactly(tuple("de/about.html",
                            "The page has no hreflang alternates, but is published in de, de-CH, en."));

            List<Finding> single = QualityRuleHarness.of(new HreflangRule())
                    .locales(LOCALES)
                    .page(key("de/about.html", ABOUT, "de"), QualityRuleHarness.fixture("seo/0210-fail-none-de.html"))
                    .run()
                    .of("SF-CHK-0210");
            assertThat(single).isEmpty();
        }

        @Test
        void aProjectWithoutLanguagesIsSkipped() {
            assertThat(QualityRuleHarness.of(new HreflangRule())
                            .pageFromFixture("de/about.html", "seo/0210-fail-incomplete-de.html")
                            .run()
                            .of("SF-CHK-0210"))
                    .isEmpty();
        }
    }

    @Nested
    class Canonical {

        @Test
        void aCanonicalMustResolveToAPageOfTheBuild() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new CanonicalRule())
                    .pageFromFixture("page.html", "seo/0211-pass.html")
                    .pageFromFixture("none.html", "seo/0211-pass-none.html")
                    .pageFromFixture("external.html", "seo/0211-pass-external.html")
                    .pageFromFixture("missing-target.html", "seo/0211-fail-missing-target.html")
                    .pageFromFixture("relative.html", "seo/0211-fail-relative.html")
                    .pageFromFixture("empty.html", "seo/0211-fail-empty.html")
                    .pageFromFixture("pdf.html", "seo/0211-fail-media.html")
                    .media("media/report.pdf")
                    .run();

            assertThat(result.of("SF-CHK-0211"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("empty.html", "head > link", "The canonical link is empty."),
                            tuple("missing-target.html", "head > link", "The canonical link \"https://example.com/gone.html\" "
                                    + "points at gone.html, which is not an output of this build."),
                            tuple("pdf.html", "head > link", "The canonical link "
                                    + "\"https://example.com/media/report.pdf\" points at media/report.pdf, which is not a page."),
                            tuple("relative.html", "head > link", "The canonical link \"page.html\" is relative; "
                                    + "with the target's base URL it must be absolute (https://example.com/page.html)."));
        }

        @Test
        void withoutABaseUrlARelativeCanonicalIsFine() {
            assertThat(QualityRuleHarness.of(new CanonicalRule())
                            .baseUrl("")
                            .pageFromFixture("page.html", "seo/0211-fail-relative.html")
                            .run()
                            .of("SF-CHK-0211"))
                    .isEmpty();
        }

        @Test
        void requiredReportsPagesWithoutACanonical() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new CanonicalRule())
                    .configure("SF-CHK-0211", QualitySeverity.ERROR, Map.of("required", true))
                    .pageFromFixture("page.html", "seo/0211-pass.html")
                    .pageFromFixture("none.html", "seo/0211-pass-none.html")
                    .run();

            assertThat(result.of("SF-CHK-0211"))
                    .extracting(f -> f.output().path(), Finding::severity, Finding::message)
                    .containsExactly(tuple("none.html", QualitySeverity.ERROR, "The page has no <link rel=\"canonical\">."));
            assertThat(result.heldBack()).containsExactly("none.html");
        }

        @Test
        void aPaginatedPagePointsAtPageOneOrItself() {
            UUID blog = UUID.randomUUID();
            QualityRuleHarness.Result result = QualityRuleHarness.of(new CanonicalRule())
                    .page(new OutputKey("blog.html", blog, "html", null, 1), QualityRuleHarness.fixture("seo/0211-pass-page2-to-page1.html"))
                    .page(new OutputKey("blog-2.html", blog, "html", null, 2),
                            QualityRuleHarness.fixture("seo/0211-pass-page2-to-page1.html"))
                    .page(new OutputKey("blog-2b.html", blog, "html", null, 2),
                            QualityRuleHarness.fixture("seo/0211-pass-page2-to-itself.html").replace("blog-2.html", "blog-2b.html"))
                    .page(new OutputKey("blog-3.html", blog, "html", null, 3),
                            QualityRuleHarness.fixture("seo/0211-fail-page3-to-page2.html"))
                    .run();

            assertThat(result.of("SF-CHK-0211"))
                    .extracting(f -> f.output().path(), Finding::message)
                    .containsExactly(tuple("blog-3.html",
                            "The canonical link of page 3 points at page 2 of the same page; it should point at page 1 or "
                                    + "at itself."));
        }
    }

    @Nested
    class NoIndex {

        @Test
        void aNoIndexPageNeedsARobotsNoindexMeta() {
            QualityRuleHarness.Result result = QualityRuleHarness.of(new NoIndexRobotsRule())
                    .pageFromFixture("no-robots.html", "seo/0212-fail-no-robots.html").noIndex("no-robots.html")
                    .pageFromFixture("index.html", "seo/0212-fail-index.html").noIndex("index.html")
                    .pageFromFixture("ok.html", "seo/0212-pass.html").noIndex("ok.html")
                    .pageFromFixture("none.html", "seo/0212-pass-none.html").noIndex("none.html")
                    // Not noIndex: no robots meta needed.
                    .pageFromFixture("public.html", "seo/0212-fail-no-robots.html")
                    .run();

            assertThat(result.of("SF-CHK-0212"))
                    .extracting(f -> f.output().path(), Finding::selector, Finding::message)
                    .containsExactly(
                            tuple("no-robots.html", null,
                                    "The page is hidden from search engines, but has no <meta name=\"robots\" "
                                            + "content=\"noindex\">."),
                            tuple("index.html", "head > meta:nth-of-type(3)",
                                    "The page is hidden from search engines, but its robots meta (\"index, follow\") "
                                            + "doesn't say noindex."));
        }
    }
}
