package com.acme.staticforge.generate.postprocess;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.ChannelOutputSettings.UrlStrategy;
import com.acme.staticforge.generate.RedirectFormat;
import com.acme.staticforge.generate.pipeline.OutputFile;
import com.acme.staticforge.generate.stage.PostProcessContext;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.junit.jupiter.api.Test;

/**
 * The redirect formats against golden files (M30.5.1): HTML stubs (a relative link from a nested path, the canonical
 * with and without {@code baseUrl}, a source and target with spaces and {@code &}), {@code .htaccess} (pretty URLs, a
 * {@code baseUrl} with a path prefix, appended to an existing file) and {@code redirects.json}. The {@code .htaccess}
 * lines are also read back the way Apache tokenizes a directive ({@code ap_getword_conf}: whitespace-separated words,
 * double quotes, {@code \"} inside quotes).
 */
class RedirectFormatsGoldenTest {

    private static final ChannelOutputSettings PRETTY =
            new ChannelOutputSettings("html", null, "index.html", UrlStrategy.PRETTY, true);

    // ------------------------------------------------------------------
    // HTML stubs
    // ------------------------------------------------------------------

    @Test
    void aNestedStubLinksRelativeToItsOwnPathWithAnAbsoluteCanonical() {
        Redirect redirect = new Redirect("docs/guides/old.html", "products/new.html", "html", "");

        String stub = HtmlStubPostProcessor.stub(ctx("https://example.com/site/", List.of(redirect), Map.of()), redirect);

        assertThat(stub).isEqualTo(golden("stub-nested-base-url.html"));
    }

    @Test
    void withoutBaseUrlTheCanonicalIsTheRelativeLink() {
        Redirect redirect = new Redirect("docs/guides/old.html", "products/new.html", "html", "");

        String stub = HtmlStubPostProcessor.stub(ctx("", List.of(redirect), Map.of()), redirect);

        assertThat(stub).isEqualTo(golden("stub-nested-relative.html"));
    }

    @Test
    void spacesAndAmpersandsAreEncodedAndEscapedAndAFragmentIsKept() {
        Redirect redirect = new Redirect("a b/old & new.html", "new & improved.html#top", "html", "");

        String stub = HtmlStubPostProcessor.stub(ctx("https://example.com", List.of(redirect), Map.of()), redirect);

        assertThat(stub).isEqualTo(golden("stub-spaces-and-ampersand.html"));
        Document parsed = Jsoup.parse(stub);
        assertThat(parsed.selectFirst("meta[http-equiv=refresh]").attr("content"))
                .isEqualTo("0; url=../new%20&%20improved.html#top");
        assertThat(parsed.selectFirst("a").attr("href")).isEqualTo("../new%20&%20improved.html#top");
        assertThat(parsed.selectFirst("meta[name=robots]").attr("content")).isEqualTo("noindex");
    }

    @Test
    void prettyUrlsLinkTheDirectoryAndAbsoluteTargetsStayAsTheyAre() {
        Redirect toDirectory = new Redirect("about/index.html", "company/about/index.html", "html", "");
        Redirect toSite = new Redirect("legacy.html", "https://example.org/x?a=1&b=2", "html", "");
        Redirect toRoot = new Redirect("start/index.html", "index.html", "html", "");
        Map<String, ChannelOutputSettings> pretty = Map.of("html", PRETTY);

        Document directory = Jsoup.parse(HtmlStubPostProcessor.stub(
                ctx("https://example.com/site", List.of(toDirectory), pretty), toDirectory));
        Document site = Jsoup.parse(HtmlStubPostProcessor.stub(ctx("", List.of(toSite), pretty), toSite));
        Document root = Jsoup.parse(HtmlStubPostProcessor.stub(ctx("", List.of(toRoot), pretty), toRoot));

        assertThat(directory.selectFirst("a").attr("href")).isEqualTo("../company/about/");
        assertThat(directory.selectFirst("link[rel=canonical]").attr("href"))
                .isEqualTo("https://example.com/site/company/about/");
        assertThat(site.selectFirst("a").attr("href")).isEqualTo("https://example.org/x?a=1&b=2");
        assertThat(site.selectFirst("link[rel=canonical]").attr("href")).isEqualTo("https://example.org/x?a=1&b=2");
        assertThat(root.selectFirst("a").attr("href")).isEqualTo("../");
    }

    @Test
    void aScriptCannotBeClosedFromAPath() {
        Redirect redirect = new Redirect("x.html", "https://example.org/a?q=</script><b>", "html", "");

        String stub = HtmlStubPostProcessor.stub(ctx("", List.of(redirect), Map.of()), redirect);

        assertThat(stub).contains("<script>location.replace(\"https://example.org/a?q=\\u003c/script>\\u003cb>\" + location.hash)")
                .doesNotContain("q=</script>");
    }

    @Test
    void stubsAreWrittenAtTheSourcePathsButNeverOverAFileTheBuildHas() {
        List<Redirect> redirects = List.of(
                new Redirect("old.html", "new.html", "html", ""),
                new Redirect("sitemap.xml", "new.html", "html", ""),
                new Redirect("old.html", "other.html", "md", ""));
        List<OutputFile> files = List.of(new OutputFile("sitemap.xml", "<urlset/>".getBytes(StandardCharsets.UTF_8)));

        List<OutputFile> result = new HtmlStubPostProcessor().process(ctx("", redirects, Map.of()), files);

        assertThat(result).extracting(OutputFile::path).containsExactly("sitemap.xml", "old.html");
        assertThat(new String(result.get(0).bytes(), StandardCharsets.UTF_8)).isEqualTo("<urlset/>");
        assertThat(new String(result.get(1).bytes(), StandardCharsets.UTF_8)).contains("url=new.html");
        assertThat(new HtmlStubPostProcessor().process(
                ctx("", redirects, Map.of(), Set.of(RedirectFormat.JSON)), files)).isEqualTo(files);
    }

    // ------------------------------------------------------------------
    // .htaccess
    // ------------------------------------------------------------------

    @Test
    void htaccessWithPrettyUrlsAndABaseUrlPath() {
        List<Redirect> redirects = List.of(
                new Redirect("say \"hi\".html", "hello.html", "html", ""),
                new Redirect("old page.html", "new page.html", "html", ""),
                new Redirect("legacy.html", "https://example.org/x?a=1&b=2", "html", ""),
                new Redirect("about/index.html", "company/about/index.html", "html", ""));
        PostProcessContext ctx = ctx("https://example.com/site/", redirects, Map.of("html", PRETTY),
                Set.of(RedirectFormat.HTACCESS));

        List<OutputFile> result = new HtaccessPostProcessor().process(ctx, List.of());

        assertThat(result).singleElement().satisfies(file -> {
            assertThat(file.path()).isEqualTo(".htaccess");
            String text = new String(file.bytes(), StandardCharsets.UTF_8);
            assertThat(text).isEqualTo(golden("htaccess-pretty-base-path.txt"));
            // Read back as Apache would: tokenize, match the decoded request path, substitute the target.
            Map<String, String> expected = Map.of(
                    "/site/about/", "/site/company/about/",
                    "/site/legacy.html", "https://example.org/x?a=1&b=2",
                    "/site/old page.html", "/site/new%20page.html",
                    "/site/say \"hi\".html", "/site/hello.html");
            List<String> lines = text.lines().toList();
            assertThat(lines.subList(1, lines.size() - 1)).hasSize(expected.size()).allSatisfy(line -> {
                List<String> words = apacheWords(line);
                assertThat(words).hasSize(4);
                assertThat(words.subList(0, 2)).containsExactly("RedirectMatch", "301");
                List<String> matched = expected.keySet().stream().filter(path -> matches(words.get(2), path)).toList();
                assertThat(matched).as("%s matches exactly one source", line).hasSize(1);
                assertThat(substitute(words.get(3))).isEqualTo(expected.get(matched.get(0)));
                assertThat(matches(words.get(2), "/site/about/team/")).isFalse();
            });
        });
    }

    @Test
    void htaccessIsAppendedToTheBuildsOwnFileReplacingAStaleBlock() {
        String existing = "Options -Indexes\n" + HtaccessPostProcessor.BEGIN + "\nRedirect 301 \"/x.html\" \"/y.html\"\n"
                + HtaccessPostProcessor.END + "\nErrorDocument 404 /404.html";
        List<OutputFile> files = List.of(
                new OutputFile("index.html", "<p>home</p>".getBytes(StandardCharsets.UTF_8)),
                new OutputFile(".htaccess", existing.getBytes(StandardCharsets.UTF_8)));
        PostProcessContext ctx = ctx("", List.of(new Redirect("a.html", "b.html", "html", "")), Map.of(),
                Set.of(RedirectFormat.HTACCESS));

        List<OutputFile> once = new HtaccessPostProcessor().process(ctx, files);
        List<OutputFile> twice = new HtaccessPostProcessor().process(ctx, once);

        assertThat(once).extracting(OutputFile::path).containsExactly("index.html", ".htaccess");
        assertThat(new String(once.get(1).bytes(), StandardCharsets.UTF_8)).isEqualTo(golden("htaccess-appended.txt"));
        assertThat(new String(twice.get(1).bytes(), StandardCharsets.UTF_8)).isEqualTo(golden("htaccess-appended.txt"));

        // Without the format the build's own file stays, minus a block an earlier build appended; none is written.
        List<OutputFile> off = new HtaccessPostProcessor().process(
                ctx("", ctx.redirects(), Map.of(), Set.of(RedirectFormat.HTML_STUB)), once);
        assertThat(new String(off.get(1).bytes(), StandardCharsets.UTF_8))
                .isEqualTo("Options -Indexes\nErrorDocument 404 /404.html\n");
        assertThat(new HtaccessPostProcessor().process(ctx("", ctx.redirects(), Map.of(), Set.of()), List.of())).isEmpty();
    }

    @Test
    void anAnchoredRuleNeverMatchesThePagesBelowItsDirectory() {
        String regex = HtaccessPostProcessor.pattern("/about/");

        assertThat(regex).isEqualTo("^/about/$");
        assertThat(matches(regex, "/about/")).isTrue();
        assertThat(matches(regex, "/about/team/")).isFalse();
        assertThat(matches(regex, "/about/index.html")).isFalse();
        assertThat(matches(regex, "/x/about/")).isFalse();
    }

    @Test
    void regexMetacharactersInAPathMatchOnlyThemselves() {
        String path = "/c++ (v1.2)/[draft]{2}^$|*?.html";
        String line = new String(new HtaccessPostProcessor().process(
                ctx("", List.of(new Redirect(path.substring(1), "to $1 & more.html#a", "html", "")), Map.of(),
                        Set.of(RedirectFormat.HTACCESS)), List.of()).get(0).bytes(), StandardCharsets.UTF_8).lines().toList().get(1);

        List<String> words = apacheWords(line);

        assertThat(words.get(2)).isEqualTo("^/c\\+\\+ \\(v1\\.2\\)/\\[draft\\]\\{2\\}\\^\\$\\|\\*\\?\\.html$");
        assertThat(matches(words.get(2), path)).isTrue();
        assertThat(matches(words.get(2), "/cc (v1x2)/d2.html")).isFalse();
        assertThat(matches(words.get(2), "/c++ (v1.2)/[draft]{2}^$|*?xhtml")).isFalse();
        // The target is literal: no backreference, no whole-match '&'.
        assertThat(words.get(3)).isEqualTo("/to%20\\$1%20\\&%20more.html#a");
        assertThat(substitute(words.get(3))).isEqualTo("/to%20$1%20&%20more.html#a");
    }

    // ------------------------------------------------------------------
    // redirects.json
    // ------------------------------------------------------------------

    @Test
    void redirectsJsonCarriesChannelLocaleAndStatus() {
        PostProcessContext ctx = ctx("", List.of(
                        new Redirect("docs/old.html", "docs/new.html", "html", ""),
                        new Redirect("en/a.html", "https://example.org/", "html", "en")),
                Map.of(), Set.of(RedirectFormat.JSON));

        List<OutputFile> result = new RedirectPostProcessor().process(ctx, List.of());

        assertThat(result).singleElement().satisfies(file -> {
            assertThat(file.path()).isEqualTo("redirects.json");
            assertThat(new String(file.bytes(), StandardCharsets.UTF_8)).isEqualTo(golden("redirects.json"));
        });
        assertThat(new RedirectPostProcessor().process(ctx("", List.of(), Map.of(), Set.of(RedirectFormat.JSON)), List.of()))
                .singleElement()
                .satisfies(file -> assertThat(new String(file.bytes(), StandardCharsets.UTF_8)).isEqualTo("[]"));
        assertThat(new RedirectPostProcessor().process(ctx("", ctx.redirects(), Map.of()), List.of())).isEmpty();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static PostProcessContext ctx(
            String baseUrl, List<Redirect> redirects, Map<String, ChannelOutputSettings> settings) {
        return ctx(baseUrl, redirects, settings, RedirectFormat.DEFAULT);
    }

    private static PostProcessContext ctx(String baseUrl, List<Redirect> redirects,
            Map<String, ChannelOutputSettings> settings, Set<RedirectFormat> formats) {
        return new PostProcessContext(1L, "p", baseUrl, List.of("html"), List.of(), false, redirects, List.of(), Map.of(),
                null, formats, settings);
    }

    /** A golden file, with the line endings a checkout may have given it normalized. */
    private static String golden(String name) {
        try (InputStream in = RedirectFormatsGoldenTest.class.getResourceAsStream("/postprocess/redirects/" + name)) {
            assertThat(in).as("golden file %s", name).isNotNull();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Whether {@code regex} (PCRE; these simple anchored patterns read the same in java.util.regex) matches {@code path}. */
    private static boolean matches(String regex, String path) {
        return java.util.regex.Pattern.compile(regex).matcher(path).find();
    }

    /**
     * mod_alias's substitution of a {@code RedirectMatch} target ({@code ap_pregsub}): {@code $0}–{@code $9} and
     * {@code &} insert the match, a backslash makes the next character literal. The targets here must come back
     * literal, so an unescaped reference fails the test.
     */
    private static String substitute(String target) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < target.length(); i++) {
            char c = target.charAt(i);
            boolean reference = c == '&' || (c == '$' && i + 1 < target.length() && Character.isDigit(target.charAt(i + 1)));
            assertThat(reference).as("unescaped reference at %d in %s", i, target).isFalse();
            if (c == '\\' && i + 1 < target.length()) {
                c = target.charAt(++i);
            }
            out.append(c);
        }
        return out.toString();
    }

    /**
     * The words of a directive as Apache's {@code ap_getword_conf} reads them: separated by whitespace; a word starting
     * with {@code "} runs to the next unescaped {@code "}, and {@code \"} inside it is a quote.
     */
    private static List<String> apacheWords(String line) {
        List<String> words = new ArrayList<>();
        int i = 0;
        while (i < line.length()) {
            while (i < line.length() && Character.isWhitespace(line.charAt(i))) {
                i++;
            }
            if (i >= line.length()) {
                break;
            }
            StringBuilder word = new StringBuilder();
            if (line.charAt(i) == '"') {
                i++;
                while (i < line.length() && line.charAt(i) != '"') {
                    if (line.charAt(i) == '\\' && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        i++;
                    }
                    word.append(line.charAt(i++));
                }
                assertThat(i).as("unterminated quote in %s", line).isLessThan(line.length());
                i++;
            } else {
                while (i < line.length() && !Character.isWhitespace(line.charAt(i))) {
                    word.append(line.charAt(i++));
                }
            }
            words.add(word.toString());
        }
        return words;
    }
}
