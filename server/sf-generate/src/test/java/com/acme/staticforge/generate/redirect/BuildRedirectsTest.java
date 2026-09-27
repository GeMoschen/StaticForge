package com.acme.staticforge.generate.redirect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.generate.postprocess.Redirect;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.generate.target.BuildManifest.Kind;
import com.acme.staticforge.generate.target.BuildManifest.Output;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectService.AutoCandidate;
import com.acme.staticforge.redirect.RedirectState;
import com.acme.staticforge.redirect.ResolvedRedirect;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class BuildRedirectsTest {

    private static final UUID PAGE = UUID.fromString("00000000-0000-7000-8000-00000000000a");
    private static final UUID OTHER = UUID.fromString("00000000-0000-7000-8000-00000000000b");
    private static final UUID MEDIA = UUID.fromString("00000000-0000-7000-8000-00000000000c");

    @Test
    void aPageAtAnotherPathThanInTheCurrentBuildIsACandidate() {
        BuildManifest current = manifest(page("old/about.html", PAGE, null, null), page("home.html", OTHER, null, null));

        BuildRedirects.Result result = BuildRedirects.of(current, List.of(), false)
                .forOutputs(List.of(rendered("new/about.html", PAGE, null, null), rendered("home.html", OTHER, null, null)));

        assertThat(result.candidates()).containsExactly(new AutoCandidate("html", "", "old/about.html", PAGE, 1));
        assertThat(result.redirects()).containsExactly(new Redirect("old/about.html", "new/about.html", "html", ""));
        assertThat(result.sources()).containsExactly("old/about.html");
    }

    @Test
    void withoutACurrentBuildNothingIsDetectedButStoredRedirectsAreEmitted() {
        RedirectEntry manual = entry(RedirectKind.MANUAL, "legacy.html", "");
        manual.targetAsset(PAGE, 1);

        BuildRedirects.Result result = BuildRedirects.of(null, List.of(manual), false)
                .forOutputs(List.of(rendered("about.html", PAGE, null, null)));

        assertThat(result.candidates()).isEmpty();
        assertThat(result.redirects()).containsExactly(new Redirect("legacy.html", "about.html", "html", ""));
    }

    @Test
    void carriedOutputsAndUnchangedPathsAddNothingNorDoRemovedOutputs() {
        BuildManifest current = manifest(
                page("a.html", PAGE, null, null), page("b.html", OTHER, null, null), page("gone.html", MEDIA, null, null));

        BuildRedirects.Result result = BuildRedirects.of(current, List.of(), false).forOutputs(List.of(
                rendered("a.html", PAGE, null, null),
                new IndexedOutput(new OutputKey("b-moved.html", OTHER, "html", null, null), Kind.PAGE, true)));

        assertThat(result.candidates()).isEmpty();
        assertThat(result.resolved()).isEmpty();
    }

    @Test
    void aCandidateRepointsTheAutoEntryOfItsPathButNeverTouchesAManualOne() {
        BuildManifest current = manifest(page("a.html", PAGE, null, null), page("b.html", OTHER, null, null));
        RedirectEntry auto = entry(RedirectKind.AUTO, "a.html", "");
        auto.targetAsset(OTHER, 1);
        RedirectEntry manual = entry(RedirectKind.MANUAL, "b.html", "");
        manual.targetPath("https://example.org/b");

        BuildRedirects.Result result = BuildRedirects.of(current, List.of(auto, manual), false).forOutputs(List.of(
                rendered("a2.html", PAGE, null, null), rendered("b2.html", OTHER, null, null)));

        assertThat(result.candidates()).containsExactly(new AutoCandidate("html", "", "a.html", PAGE, 1));
        assertThat(result.redirects()).containsExactly(
                new Redirect("a.html", "a2.html", "html", ""),
                new Redirect("b.html", "https://example.org/b", "html", ""));
    }

    @Test
    void aChainOfMovesLeadsEveryOldPathToTheNewOneInOneHop() {
        RedirectEntry first = entry(RedirectKind.AUTO, "a.html", "");
        first.targetAsset(PAGE, 1);
        BuildManifest current = manifest(page("b.html", PAGE, null, null));

        BuildRedirects.Result result = BuildRedirects.of(current, List.of(first), false)
                .forOutputs(List.of(rendered("c.html", PAGE, null, null)));

        assertThat(result.redirects()).containsExactly(
                new Redirect("a.html", "c.html", "html", ""), new Redirect("b.html", "c.html", "html", ""));
    }

    @Test
    void shadowedAndDanglingRedirectsAreKeptOutOfTheBuild() {
        RedirectEntry shadowed = entry(RedirectKind.AUTO, "home.html", "");
        shadowed.targetAsset(PAGE, 1);
        RedirectEntry dangling = entry(RedirectKind.AUTO, "x.html", "");
        dangling.targetAsset(UUID.randomUUID(), 1);
        RedirectEntry mediaShadowed = entry(RedirectKind.MANUAL, "logo.png", "");
        mediaShadowed.targetPath("about.html");
        RedirectEntry siteFileShadowed = entry(RedirectKind.MANUAL, "sitemap.xml", "");
        siteFileShadowed.targetPath("about.html");

        BuildRedirects.Result result = BuildRedirects.of(
                        null, List.of(shadowed, dangling, mediaShadowed, siteFileShadowed), false)
                .forOutputs(List.of(
                        rendered("about.html", PAGE, null, null),
                        rendered("home.html", OTHER, null, null),
                        new IndexedOutput(new OutputKey("logo.png", MEDIA, null, null, null), Kind.MEDIA, false),
                        new IndexedOutput(new OutputKey("sitemap.xml", null, null, null, null), Kind.SITE, false)));

        assertThat(result.resolved()).extracting(r -> r.rule().fromPath(), ResolvedRedirect::state).containsExactlyInAnyOrder(
                tuple("home.html", RedirectState.SHADOWED),
                tuple("logo.png", RedirectState.SHADOWED),
                tuple("sitemap.xml", RedirectState.SHADOWED),
                tuple("x.html", RedirectState.DANGLING));
        assertThat(result.redirects()).isEmpty();
    }

    @Test
    void localesAndPageNumbersArePartOfTheKey() {
        BuildManifest current = manifest(
                page("en/list.html", PAGE, "en", null),
                page("en/list-2.html", PAGE, "en", 2),
                page("de/liste.html", PAGE, "de", null));

        BuildRedirects.Result result = BuildRedirects.of(current, List.of(), true).forOutputs(List.of(
                rendered("en/items.html", PAGE, "en", null),
                rendered("en/items-2.html", PAGE, "en", 2),
                rendered("de/liste.html", PAGE, "de", null)));

        assertThat(result.candidates()).containsExactly(
                new AutoCandidate("html", "en", "en/list-2.html", PAGE, 2),
                new AutoCandidate("html", "en", "en/list.html", PAGE, 1));
        assertThat(result.redirects()).containsExactly(
                new Redirect("en/list-2.html", "en/items-2.html", "html", "en"),
                new Redirect("en/list.html", "en/items.html", "html", "en"));
    }

    @Test
    void aManifestWithoutLanguagesIsNotComparedInALocalizedProject() {
        BuildManifest current = manifest(page("about.html", PAGE, null, null));

        assertThat(BuildRedirects.of(current, List.of(), true)
                        .forOutputs(List.of(rendered("en/about.html", PAGE, "en", null))).candidates())
                .isEmpty();
        assertThat(BuildRedirects.of(current, List.of(), false)
                        .forOutputs(List.of(rendered("about-us.html", PAGE, null, null))).candidates())
                .hasSize(1);
    }

    @Test
    void aDryRunGetsTheCandidatesOfThePlannedOutputs() {
        BuildManifest current = manifest(page("a.html", PAGE, null, null), page("b.html", OTHER, null, null));
        RedirectEntry manual = entry(RedirectKind.MANUAL, "b.html", "");
        manual.targetPath("elsewhere.html");

        List<AutoCandidate> candidates = BuildRedirects.of(current, List.of(manual), false).candidates(List.of(
                new OutputKey("a-new.html", PAGE, "html", null, null), new OutputKey("b-new.html", OTHER, "html", null, null)));

        assertThat(candidates).containsExactly(new AutoCandidate("html", "", "a.html", PAGE, 1));
    }

    private static BuildManifest manifest(Output... outputs) {
        return new BuildManifest(BuildManifest.VERSION, 1, 1, 1, Set.of("html"), List.of(outputs));
    }

    private static Output page(String path, UUID asset, String locale, Integer pageNumber) {
        return new Output(path, Kind.PAGE, asset, "html", pageNumber, locale, Set.of());
    }

    private static IndexedOutput rendered(String path, UUID asset, String locale, Integer pageNumber) {
        return new IndexedOutput(new OutputKey(path, asset, "html", locale, pageNumber), Kind.PAGE, false);
    }

    private static RedirectEntry entry(RedirectKind kind, String fromPath, String locale) {
        return new RedirectEntry(1L, "html", locale, fromPath, kind, Instant.EPOCH, null);
    }
}
