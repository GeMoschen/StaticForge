package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.quality.AssetLabel;
import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.quality.rules.links.DeletedTargetRule;
import com.acme.staticforge.generate.quality.rules.links.EmptyLinkRule;
import com.acme.staticforge.generate.quality.rules.links.HeldBackTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingAnchorRule;
import com.acme.staticforge.generate.quality.rules.links.MissingLinkTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingMediaRule;
import com.acme.staticforge.generate.quality.rules.links.OtherChannelTargetRule;
import com.acme.staticforge.generate.quality.rules.links.RedirectedTargetRule;
import com.acme.staticforge.generate.quality.rules.links.UnreleasedTargetRule;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.ProjectLocale;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The link rules {@code SF-CHK-0101}–{@code 0109} (M30.2.1) over the fixtures in {@code quality/links/}, each with every
 * link rule registered — so a fixture also proves which neighbouring rule a case belongs to instead.
 *
 * <p>The page under test is served at {@code docs/guide.html} in a site with locales {@code en} (no prefix) and
 * {@code de}, a paginated blog ({@code blog.html}, {@code blog-2.html}), a pretty-URL page ({@code about/index.html}),
 * a Markdown channel ({@code docs/guide.md}), media, a site file, a held-back page ({@code held.html}) and three
 * redirect sources ({@code old.html}, {@code old-section/index.html}, {@code de/docs/alt.html}).
 */
class LinkRulesTest {

    private static final String GUIDE_PATH = "docs/guide.html";
    private static final UUID GUIDE = UUID.randomUUID();
    private static final UUID BLOG = UUID.randomUUID();
    private static final UUID TEAM = UUID.randomUUID();
    private static final UUID PORTRAIT = UUID.randomUUID();

    private static QualityRule[] linkRules() {
        return new QualityRule[] {
            new MissingLinkTargetRule(), new MissingMediaRule(), new HeldBackTargetRule(), new UnreleasedTargetRule(),
            new DeletedTargetRule(), new OtherChannelTargetRule(), new MissingAnchorRule(), new EmptyLinkRule(),
            new RedirectedTargetRule()
        };
    }

    private static String page(String title, String body) {
        return "<!doctype html><html lang=\"en\"><head><title>" + title + "</title></head><body><h1>" + title + "</h1>"
                + body + "</body></html>";
    }

    /** The site around the page under test, whose text is fixture {@code quality/links/<fixture>}. */
    private static QualityRuleHarness site(String fixture) {
        return QualityRuleHarness.of(linkRules())
                .locales(LocaleConfig.of(
                        List.of(new ProjectLocale("en", "English"), new ProjectLocale("de", "Deutsch")), "en", Map.of(),
                        true))
                .channel("md", ChannelOutputSettings.of("md", "md", null))
                .asset(new AssetLabel(GUIDE, "guide", "Guide", "PAGE"))
                .page(new OutputKey(GUIDE_PATH, GUIDE, "html", "en", null), QualityRuleHarness.fixture("links/" + fixture))
                .page(new OutputKey("de/docs/guide.html", GUIDE, "html", "de", null),
                        page("Anleitung", "<h2 id=\"einfuehrung\">Einführung</h2>"))
                .unchecked(new OutputKey("docs/guide.md", GUIDE, "md", "en", null))
                .unchecked(new OutputKey("de/docs/guide.md", GUIDE, "md", "de", null))
                .page(new OutputKey("index.html", UUID.randomUUID(), "html", "en", null), page("Home", ""))
                .page(new OutputKey("about/index.html", TEAM, "html", "en", null), page("About", "<h2 id=\"team\">Team</h2>"))
                .page(new OutputKey("blog.html", BLOG, "html", "en", 1), page("Blog", ""))
                .page(new OutputKey("blog-2.html", BLOG, "html", "en", 2), page("Blog, page 2", "<nav id=\"page-2\"></nav>"))
                .media("assets/media/logo.png")
                .media("assets/media/logo@2x.png")
                .media("assets/media/doc.pdf")
                .media("assets/media/app.js")
                .media("de/assets/media/clip.mp4")
                .siteFile("sitemap.xml")
                .heldBack("held.html")
                .redirectSource("old.html")
                .redirectSource("old-section/index.html")
                .redirectSource("de/docs/alt.html");
    }

    private static List<String> onGuide(QualityRuleHarness.Result result, String code) {
        return result.of(code).stream()
                .peek(finding -> assertThat(finding.output().path()).isEqualTo(GUIDE_PATH))
                .map(Finding::selector)
                .toList();
    }

    // ------------------------------------------------------------------
    // SF-CHK-0101 link to a missing page or file
    // ------------------------------------------------------------------

    @Test
    void reportsEveryLinkToAPathTheBuildDoesNotPublish() {
        QualityRuleHarness.Result result = site("0101-fail.html").run();

        assertThat(result.of(MissingLinkTargetRule.CODE))
                .extracting(finding -> finding.output().path(), Finding::selector, Finding::message, Finding::severity)
                .containsExactly(
                        tuple(GUIDE_PATH, "body > nav > a:nth-of-type(1)",
                                "Link to 'missing.html' (docs/missing.html): no page or file of this build is there.",
                                QualitySeverity.WARNING),
                        tuple(GUIDE_PATH, "body > nav > a:nth-of-type(2)",
                                "Link to '/gone.html' (gone.html): no page or file of this build is there.",
                                QualitySeverity.WARNING),
                        tuple(GUIDE_PATH, "body > nav > a:nth-of-type(3)",
                                "Link to 'https://example.com/archive/' (archive/index.html): no page or file of this "
                                        + "build is there.",
                                QualitySeverity.WARNING),
                        tuple(GUIDE_PATH, "body > nav > a:nth-of-type(4)",
                                "Link to '../blog-3.html' (blog-3.html): no page or file of this build is there.",
                                QualitySeverity.WARNING),
                        tuple(GUIDE_PATH, "body > nav > a:nth-of-type(5)",
                                "Link to '../de/docs/missing.html' (de/docs/missing.html): no page or file of this build "
                                        + "is there.",
                                QualitySeverity.WARNING),
                        tuple(GUIDE_PATH, "body > nav > a:nth-of-type(6)",
                                "Link to 'missing.html' (docs/missing.html): no page or file of this build is there.",
                                QualitySeverity.WARNING),
                        tuple(GUIDE_PATH, "body > iframe",
                                "Link to '../embed.html' (embed.html): no page or file of this build is there.",
                                QualitySeverity.WARNING));
        assertThat(result.codes()).containsOnly(MissingLinkTargetRule.CODE);
    }

    @Test
    void linksThatResolveAreNot0101AndHeldBackRedirectedAndMediaTargetsBelongToTheirOwnRules() {
        QualityRuleHarness.Result result = site("0101-pass.html").run();

        assertThat(result.of(MissingLinkTargetRule.CODE)).isEmpty();
        assertThat(onGuide(result, MissingMediaRule.CODE)).containsExactly("body > img");
        assertThat(onGuide(result, HeldBackTargetRule.CODE)).containsExactly("body > nav > a:nth-of-type(12)");
        assertThat(onGuide(result, RedirectedTargetRule.CODE)).containsExactly("body > nav > a:nth-of-type(13)");
        assertThat(result.codes()).containsOnly(
                MissingMediaRule.CODE, HeldBackTargetRule.CODE, RedirectedTargetRule.CODE);
    }

    @Test
    void aReferenceToATargetMissingFromTheProjectIs0101WithItsUuidAndField() {
        UUID nowhere = UUID.randomUUID();
        QualityRuleHarness.Result result = site("reference-fail.html")
                .event(GUIDE_PATH, new ReferenceEvent(ReferenceEvent.Kind.MISSING, "page", nowhere, null, "en", "content.team"))
                .event(GUIDE_PATH, new ReferenceEvent(ReferenceEvent.Kind.MISSING, "media", PORTRAIT, null, "en"))
                .run();

        assertThat(result.of(MissingLinkTargetRule.CODE))
                .extracting(finding -> finding.output().path(), Finding::selector, Finding::message)
                .containsExactly(
                        tuple(GUIDE_PATH, null, "Reference to a page that doesn't exist (" + nowhere
                                + ") in field content.team: it renders an empty link."),
                        tuple(GUIDE_PATH, null, "Reference to a media that doesn't exist (" + PORTRAIT
                                + "): it renders an empty link."));
        assertThat(result.of(EmptyLinkRule.CODE)).as("the empty href is the reference's").isEmpty();
    }

    // ------------------------------------------------------------------
    // SF-CHK-0102 link to missing media
    // ------------------------------------------------------------------

    @Test
    void reportsEveryMediaReferenceToAPathTheBuildDoesNotPublish() {
        QualityRuleHarness.Result result = site("0102-fail.html").run();

        assertThat(result.of(MissingMediaRule.CODE))
                .extracting(Finding::selector, Finding::message)
                .containsExactly(
                        tuple("head > link", "Missing media '/css/site.css' (css/site.css) (link href): no file of this "
                                + "build is there."),
                        tuple("head > script", "Missing media 'app.js' (docs/app.js) (script src): no file of this build "
                                + "is there."),
                        tuple("body > img:nth-of-type(1)", "Missing media '../assets/media/nope.png' "
                                + "(assets/media/nope.png) (img src): no file of this build is there."),
                        tuple("body > img:nth-of-type(2)", "Missing media '/assets/media/logo@3x.png' "
                                + "(assets/media/logo@3x.png) (img srcset): no file of this build is there."),
                        tuple("body > picture > source", "Missing media 'https://example.com/assets/media/hero.webp' "
                                + "(assets/media/hero.webp) (source srcset): no file of this build is there."),
                        tuple("body > video", "Missing media '../de/assets/media/missing-clip.mp4' "
                                + "(de/assets/media/missing-clip.mp4) (video src): no file of this build is there."),
                        tuple("body > video", "Missing media 'poster.jpg' (docs/poster.jpg) (video poster): no file of "
                                + "this build is there."),
                        tuple("body > audio", "Missing media '/assets/media/podcast.mp3' (assets/media/podcast.mp3) "
                                + "(audio src): no file of this build is there."));
        assertThat(result.codes()).containsOnly(MissingMediaRule.CODE);
    }

    @Test
    void mediaThatResolvesIsNot0102AndCanonicalAndAlternatesAreLeftToTheSeoRules() {
        QualityRuleHarness.Result result = site("0102-pass.html").run();

        assertThat(result.of(MissingMediaRule.CODE)).isEmpty();
        assertThat(onGuide(result, MissingLinkTargetRule.CODE)).as("the page link, not the canonical or the alternate")
                .containsExactly("body > a");
        assertThat(result.codes()).containsOnly(MissingLinkTargetRule.CODE);
    }

    // ------------------------------------------------------------------
    // SF-CHK-0103 link to a page held back in this build
    // ------------------------------------------------------------------

    @Test
    void aLinkToAHeldBackPageIsAWarningEvenWhenConfiguredAsError() {
        QualityRuleHarness.Result result = site("0103-fail.html")
                .configure(HeldBackTargetRule.CODE, QualitySeverity.ERROR)
                .run();

        assertThat(result.of(HeldBackTargetRule.CODE))
                .extracting(Finding::selector, Finding::severity, Finding::message)
                .containsExactly(
                        tuple("body > a:nth-of-type(1)", QualitySeverity.WARNING,
                                "Link to '../held.html' (held.html): the page is held back in this build."),
                        tuple("body > a:nth-of-type(2)", QualitySeverity.WARNING,
                                "Link to 'https://example.com/held.html#intro' (held.html): the page is held back in "
                                        + "this build."));
        assertThat(result.codes()).containsOnly(HeldBackTargetRule.CODE);
        assertThat(result.heldBack()).containsExactly("held.html");
    }

    @Test
    void linksToPublishedPagesAreNot0103() {
        QualityRuleHarness.Result result = site("0103-pass.html").run();

        assertThat(result.of(HeldBackTargetRule.CODE)).isEmpty();
        assertThat(result.codes()).containsOnly(MissingLinkTargetRule.CODE);
    }

    @Test
    void noCascadeAPageHeldBackByALinkErrorNeverHoldsBackThePagesLinkingIt() {
        QualityRuleHarness.Result result = QualityRuleHarness.of(linkRules())
                .configure(MissingLinkTargetRule.CODE, QualitySeverity.ERROR)
                .configure(HeldBackTargetRule.CODE, QualitySeverity.ERROR)
                .page("index.html", page("Home", "<a href=\"broken.html\">broken</a>"))
                .page("broken.html", page("Broken", "<a href=\"gone.html\">gone</a>"))
                .run();

        assertThat(result.heldBack()).containsExactly("broken.html");
        assertThat(result.findings())
                .extracting(finding -> finding.output().path(), Finding::code, Finding::severity)
                .containsExactly(
                        tuple("broken.html", MissingLinkTargetRule.CODE, QualitySeverity.ERROR),
                        tuple("index.html", HeldBackTargetRule.CODE, QualitySeverity.WARNING));
    }

    // ------------------------------------------------------------------
    // SF-CHK-0104 / 0105 links to unreleased and deleted assets
    // ------------------------------------------------------------------

    @Test
    void unreleasedAndDeletedReferencesNameTheTargetTheLanguageAndTheField() {
        QualityRuleHarness.Result result = site("reference-fail.html")
                .asset(new AssetLabel(TEAM, "team", "The team", "PAGE"))
                .asset(new AssetLabel(PORTRAIT, null, "Portrait.jpg", "MEDIA"))
                .event(GUIDE_PATH, new ReferenceEvent(
                        ReferenceEvent.Kind.UNRELEASED, "page", TEAM, "team", "en", "content.team"))
                .event(GUIDE_PATH, new ReferenceEvent(
                        ReferenceEvent.Kind.DELETED, "media", PORTRAIT, null, "en", "bodies.main[0].content.image"))
                .event(GUIDE_PATH, new ReferenceEvent(
                        ReferenceEvent.Kind.DELETED, "section_template", BLOG, "teaser", "en", "bodies.main[1].templateRef"))
                .run();

        assertThat(result.of(UnreleasedTargetRule.CODE))
                .extracting(finding -> finding.output().path(), Finding::selector, Finding::message)
                .containsExactly(tuple(GUIDE_PATH, null, "Link to unreleased page 'team' (PAGE, en) in field "
                        + "content.team: it renders an empty link until the target is released."));
        assertThat(result.of(DeletedTargetRule.CODE))
                .extracting(Finding::message)
                .containsExactly(
                        "Link to deleted media 'Portrait.jpg' (MEDIA, en) in field bodies.main[0].content.image: it "
                                + "renders empty.",
                        "Link to deleted section template 'teaser' (en) in field bodies.main[1].templateRef: it renders "
                                + "empty.");
        assertThat(result.of(EmptyLinkRule.CODE)).as("SF-CHK-0104 already reports the empty href").isEmpty();
        assertThat(result.codes()).containsOnly(UnreleasedTargetRule.CODE, DeletedTargetRule.CODE);
    }

    @Test
    void aTemplateReferenceHasNoFieldAndAProjectWithoutLocalesNoLanguage() {
        QualityRuleHarness.Result result = QualityRuleHarness.of(linkRules())
                .page("index.html", page("Home", "<a href=\"\">team</a>"))
                .event("index.html", new ReferenceEvent(ReferenceEvent.Kind.UNRELEASED, "page", TEAM, "team", null))
                .run();

        assertThat(result.of(UnreleasedTargetRule.CODE)).extracting(Finding::message)
                .containsExactly("Link to unreleased page 'team': it renders an empty link until the target is released.");
    }

    @Test
    void referencesRenderedIntoAnotherChannelAreNotChecked() {
        QualityRuleHarness.Result result = site("reference-pass.html")
                .event("docs/guide.md", new ReferenceEvent(ReferenceEvent.Kind.UNRELEASED, "page", TEAM, "team", "en"))
                .event("docs/guide.md", new ReferenceEvent(ReferenceEvent.Kind.MISSING, "page", TEAM, null, "en"))
                .run();

        assertThat(result.findings()).isEmpty();
    }

    @Test
    void anOutputWithoutUnresolvedReferencesIsNot0104Or0105() {
        QualityRuleHarness.Result result = site("reference-pass.html").run();

        assertThat(result.findings()).isEmpty();
    }

    // ------------------------------------------------------------------
    // SF-CHK-0106 link into another channel
    // ------------------------------------------------------------------

    @Test
    void reportsLinksToPageOutputsOfAnotherChannel() {
        QualityRuleHarness.Result result = site("0106-fail.html").run();

        assertThat(result.of(OtherChannelTargetRule.CODE))
                .extracting(Finding::selector, Finding::message)
                .containsExactly(
                        tuple("body > a:nth-of-type(1)",
                                "Link to 'guide.md' (docs/guide.md) goes to page 'guide' in channel 'md', not 'html'."),
                        tuple("body > a:nth-of-type(2)",
                                "Link to 'https://example.com/de/docs/guide.md' (de/docs/guide.md) goes to page 'guide' "
                                        + "in channel 'md', not 'html'."));
        assertThat(result.codes()).containsOnly(OtherChannelTargetRule.CODE);
    }

    @Test
    void linksWithinTheChannelToMediaSiteFilesAndAnAlternateRepresentationAreNot0106() {
        QualityRuleHarness.Result result = site("0106-pass.html").run();

        assertThat(result.findings()).isEmpty();
    }

    // ------------------------------------------------------------------
    // SF-CHK-0107 missing anchor
    // ------------------------------------------------------------------

    @Test
    void reportsFragmentsThatNameNoIdOrAnchorOfTheTargetPage() {
        QualityRuleHarness.Result result = site("0107-fail.html").run();

        assertThat(result.of(MissingAnchorRule.CODE))
                .extracting(Finding::selector, Finding::message)
                .containsExactly(
                        tuple("body > a:nth-of-type(1)",
                                "Missing anchor: '#nowhere' — this page has no element with id or name 'nowhere'."),
                        tuple("body > a:nth-of-type(2)",
                                "Missing anchor: '/about/#staff' — page 'about/index.html' has no element with id or "
                                        + "name 'staff'."),
                        tuple("body > a:nth-of-type(3)",
                                "Missing anchor: 'https://example.com/blog-2.html#comments' — page 'blog-2.html' has no "
                                        + "element with id or name 'comments'."),
                        tuple("body > a:nth-of-type(4)",
                                "Missing anchor: '../de/docs/guide.html#einleitung' — page 'guide' has no element with "
                                        + "id or name 'einleitung'."),
                        tuple("body > a:nth-of-type(5)",
                                "Missing anchor: '#Intro' — this page has no element with id or name 'Intro'."));
        assertThat(result.codes()).containsOnly(MissingAnchorRule.CODE);
    }

    @Test
    void fragmentsThatResolveTopTextDirectivesMediaAndUncheckedTargetsAreNot0107() {
        QualityRuleHarness.Result result = site("0107-pass.html").run();

        assertThat(result.of(MissingAnchorRule.CODE)).isEmpty();
        assertThat(result.codes()).as("the missing page and the other channel are 0101 and 0106")
                .containsOnly(MissingLinkTargetRule.CODE, OtherChannelTargetRule.CODE);
    }

    @Test
    void aTargetWhoseIdsWereTooManyToRecordIsNotJudged() {
        StringBuilder ids = new StringBuilder();
        for (int i = 0; i <= com.acme.staticforge.generate.quality.HtmlFacts.MAX_IDS; i++) {
            ids.append("<span id=\"s").append(i).append("\"></span>");
        }
        QualityRuleHarness.Result result = QualityRuleHarness.of(linkRules())
                .page("index.html", page("Home", "<a href=\"long.html#s9999\">late</a> <a href=\"short.html#x\">x</a>"))
                .page("long.html", page("Long", ids.toString()))
                .page("short.html", page("Short", ""))
                .run();

        assertThat(result.facts().get("long.html").idsTruncated()).isTrue();
        assertThat(result.of(MissingAnchorRule.CODE)).extracting(Finding::selector)
                .containsExactly("body > a:nth-of-type(2)");
    }

    // ------------------------------------------------------------------
    // SF-CHK-0108 empty or #-only link
    // ------------------------------------------------------------------

    @Test
    void reportsEmptyWhitespaceAndHashOnlyLinks() {
        QualityRuleHarness.Result result = site("0108-fail.html").run();

        assertThat(result.of(EmptyLinkRule.CODE))
                .extracting(Finding::selector, Finding::message)
                .containsExactly(
                        tuple("body > a:nth-of-type(1)", "Empty link: the href is empty, so it only reloads the page."),
                        tuple("body > a:nth-of-type(2)", "Empty link: the href is empty, so it only reloads the page."),
                        tuple("body > a:nth-of-type(3)", "Link with href=\"#\": it goes nowhere but to the top of the page."),
                        tuple("body > a:nth-of-type(4)", "Link with href=\"#\": it goes nowhere but to the top of the page."));
        assertThat(result.codes()).containsOnly(EmptyLinkRule.CODE);
    }

    @Test
    void linksWithATargetButtonsAndPlaceholdersAreNot0108() {
        QualityRuleHarness.Result result = site("0108-pass.html").run();

        assertThat(result.findings()).isEmpty();
    }

    @Test
    void onlyAnUnresolvedUrlReferenceExplainsAnEmptyHrefAndNeverAHashOnlyOne() {
        QualityRuleHarness.Result result = QualityRuleHarness.of(linkRules())
                .page("index.html", page("Home", "<a href=\"\">empty</a> <a href=\"#\">hash</a>"))
                .event("index.html", new ReferenceEvent(
                        ReferenceEvent.Kind.DELETED, "section_template", BLOG, "teaser", null))
                .page("other.html", page("Other", "<a href=\"\">empty</a> <a href=\"#\">hash</a>"))
                .event("other.html", new ReferenceEvent(ReferenceEvent.Kind.UNRELEASED, "folder", TEAM, "team", null))
                .run();

        assertThat(result.of(EmptyLinkRule.CODE))
                .extracting(finding -> finding.output().path(), Finding::selector)
                .containsExactly(
                        tuple("index.html", "body > a:nth-of-type(1)"),
                        tuple("index.html", "body > a:nth-of-type(2)"),
                        tuple("other.html", "body > a:nth-of-type(2)"));
    }

    // ------------------------------------------------------------------
    // SF-CHK-0109 link reaches only a redirect
    // ------------------------------------------------------------------

    @Test
    void reportsLinksToPathsServedByARedirectInsteadOf0101() {
        QualityRuleHarness.Result result = site("0109-fail.html").run();

        assertThat(result.of(RedirectedTargetRule.CODE))
                .extracting(Finding::selector, Finding::message)
                .containsExactly(
                        tuple("body > a:nth-of-type(1)", "Link to '../old.html' (old.html) reaches only a redirect: it "
                                + "is an old URL; link the page's current URL instead."),
                        tuple("body > a:nth-of-type(2)", "Link to '/old-section/' (old-section/index.html) reaches only "
                                + "a redirect: it is an old URL; link the page's current URL instead."),
                        tuple("body > a:nth-of-type(3)", "Link to 'https://example.com/de/docs/alt.html#intro' "
                                + "(de/docs/alt.html) reaches only a redirect: it is an old URL; link the page's current "
                                + "URL instead."));
        assertThat(result.codes()).containsOnly(RedirectedTargetRule.CODE);
    }

    @Test
    void linksToCurrentUrlsAreNot0109() {
        QualityRuleHarness.Result result = site("0109-pass.html").run();

        assertThat(result.findings()).isEmpty();
    }

    @Test
    void aSiteWithoutRedirectSourcesReportsTheOldPathAsMissing() {
        QualityRuleHarness.Result result = QualityRuleHarness.of(linkRules())
                .page("index.html", page("Home", "<a href=\"old.html\">old</a>"))
                .run();

        assertThat(result.codes()).containsExactly(MissingLinkTargetRule.CODE);
    }

    // ------------------------------------------------------------------
    // Across the rules
    // ------------------------------------------------------------------

    @Test
    void aRuleSwitchedOffReportsNothingAndTheSameTargetTwiceInOneElementIsOneFinding() {
        QualityRuleHarness.Result result = QualityRuleHarness.of(linkRules())
                .configure(MissingLinkTargetRule.CODE, QualitySeverity.OFF)
                .page("index.html", page("Home", "<a href=\"gone.html\">gone</a>"
                        + "<img src=\"x.png\" srcset=\"x.png 1x, ./x.png 2x\" alt=\"x\">"))
                .run();

        assertThat(result.findings())
                .extracting(Finding::code, Finding::selector)
                .containsExactly(tuple(MissingMediaRule.CODE, "body > img"));
    }

    @Test
    void theLinkRulesAreSiteRulesExcept0108AndOnly0103WaitsForTheHoldBack() {
        assertThat(QualityRuleHarness.codes(linkRules())).containsExactly(
                "SF-CHK-0101", "SF-CHK-0102", "SF-CHK-0103", "SF-CHK-0104", "SF-CHK-0105", "SF-CHK-0106",
                "SF-CHK-0107", "SF-CHK-0108", "SF-CHK-0109");
        for (QualityRule rule : linkRules()) {
            assertThat(rule.defaultSeverity()).isEqualTo(QualitySeverity.WARNING);
            assertThat(rule.maxSeverity()).as(rule.code()).isEqualTo(
                    rule.code().equals(HeldBackTargetRule.CODE) ? QualitySeverity.WARNING : QualitySeverity.ERROR);
            assertThat(rule.name()).isNotBlank();
            assertThat(rule.description()).isNotBlank();
        }
        assertThat(new EmptyLinkRule()).isInstanceOf(com.acme.staticforge.generate.quality.PageRule.class);
    }
}
