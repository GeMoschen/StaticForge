package com.acme.staticforge.redirect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RedirectResolverTest {

    private static final UUID PAGE = UUID.fromString("00000000-0000-7000-8000-000000000001");
    private static final UUID OTHER = UUID.fromString("00000000-0000-7000-8000-000000000002");
    private static final UUID GONE = UUID.fromString("00000000-0000-7000-8000-000000000003");

    /** PAGE at new/page.html (en: en/new/page.html, page 2 new/page-2.html), OTHER at other.html, a media file. */
    private static final RedirectOutputs OUTPUTS = RedirectOutputs.builder()
            .page("new/page.html", PAGE, "html", null, null)
            .page("new/page-2.html", PAGE, "html", "", 2)
            .page("en/new/page.html", PAGE, "html", "en", 1)
            .page("new/page.md", PAGE, "md", null, null)
            .page("other.html", OTHER, "html", null, null)
            .file("media/logo.png")
            .build();

    @Test
    void anAssetTargetResolvesToThePagesPathInItsChannelLocaleAndPageNumber() {
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toAsset("html", "", "old/page.html", PAGE, 1),
                RedirectRule.toAsset("html", "", "old/page-2.html", PAGE, 2),
                RedirectRule.toAsset("html", "en", "en/old/page.html", PAGE, 1),
                RedirectRule.toAsset("md", "", "old/page.md", PAGE, 1)), OUTPUTS);

        assertThat(resolved).extracting(ResolvedRedirect::state).containsOnly(RedirectState.ACTIVE);
        assertThat(resolved).extracting(ResolvedRedirect::target)
                .containsExactly("new/page.html", "new/page-2.html", "en/new/page.html", "new/page.md");
        assertThat(resolved).allMatch(ResolvedRedirect::active);
    }

    @Test
    void aFixedTargetIsItselfWhetherPathOrUrl() {
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toPath("html", "", "a.html", "anywhere/not-built.html#x"),
                RedirectRule.toPath("html", "", "b.html", "https://example.com/b")), OUTPUTS);

        assertThat(resolved).extracting(ResolvedRedirect::state).containsOnly(RedirectState.ACTIVE);
        assertThat(resolved).extracting(ResolvedRedirect::target)
                .containsExactly("anywhere/not-built.html#x", "https://example.com/b");
    }

    @Test
    void aLiveSourcePathShadowsTheRedirect() {
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toAsset("html", "", "other.html", PAGE, 1),
                RedirectRule.toPath("html", "", "media/logo.png", "new/page.html"),
                RedirectRule.toAsset("html", "", "other.html", GONE, 1)), OUTPUTS);

        assertThat(resolved).extracting(ResolvedRedirect::state)
                .containsExactly(RedirectState.SHADOWED, RedirectState.SHADOWED, RedirectState.SHADOWED);
        assertThat(resolved.get(0).target()).isEqualTo("new/page.html");
        assertThat(resolved.get(2).target()).isNull();
    }

    @Test
    void siteFilesDoNotShadow() {
        // A build's own stubs and sitemap are site files: not live paths (M30.5.1 writes stubs at the source path).
        RedirectOutputs outputs = RedirectOutputs.builder().page("new.html", PAGE, "html", null, null).build();
        assertThat(outputs.isLive("old.html")).isFalse();
        assertThat(RedirectResolver.resolve(List.of(RedirectRule.toAsset("html", "", "old.html", PAGE, 1)), outputs))
                .singleElement()
                .extracting(ResolvedRedirect::state)
                .isEqualTo(RedirectState.ACTIVE);
    }

    @Test
    void aTargetWithoutOutputInTheChannelAndLocaleDangles() {
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toAsset("html", "", "gone.html", GONE, 1),
                RedirectRule.toAsset("html", "de", "de/old.html", PAGE, 1),
                RedirectRule.toAsset("txt", "", "old.txt", PAGE, 1),
                RedirectRule.toAsset("html", "", "old-3.html", PAGE, 3)), OUTPUTS);

        assertThat(resolved).extracting(ResolvedRedirect::state).containsOnly(RedirectState.DANGLING);
        assertThat(resolved).extracting(ResolvedRedirect::target).containsOnlyNulls();
    }

    @Test
    void aTargetThatIsTheSourceItselfIsALoop() {
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toAsset("html", "", "new/page.html", PAGE, 1),
                RedirectRule.toPath("html", "", "self.html", "self.html#top")), OUTPUTS);

        assertThat(resolved).extracting(ResolvedRedirect::state).containsOnly(RedirectState.LOOP);
        assertThat(RedirectResolver.active(List.of(RedirectRule.toPath("html", "", "self.html", "self.html")), OUTPUTS))
                .isEmpty();
    }

    @Test
    void cyclesAndTheRedirectsLeadingIntoThemAreLoopsButChainsAreNot() {
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toPath("html", "", "a.html", "b.html"),
                RedirectRule.toPath("html", "", "b.html", "c.html"),
                RedirectRule.toPath("html", "", "c.html", "b.html#again"),
                RedirectRule.toPath("html", "", "x.html", "y.html"),
                RedirectRule.toPath("html", "", "y.html", "new/page.html"),
                RedirectRule.toPath("html", "de", "c.html", "a.html")), OUTPUTS);

        assertThat(resolved).extracting(ResolvedRedirect::state).containsExactly(
                RedirectState.LOOP, RedirectState.LOOP, RedirectState.LOOP,
                RedirectState.ACTIVE, RedirectState.ACTIVE,
                // Another locale: its chain runs through the 'de' redirects only, and there is no 'de' redirect from a.html.
                RedirectState.ACTIVE);
        assertThat(resolved.get(3).target()).as("one hop, not collapsed").isEqualTo("y.html");
    }

    @Test
    void aShadowedRedirectDoesNotContinueAChain() {
        // other.html is live, so the redirect from it is not emitted and a → other.html ends there.
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toPath("html", "", "a.html", "other.html"),
                RedirectRule.toPath("html", "", "other.html", "a.html")), OUTPUTS);

        assertThat(resolved).extracting(ResolvedRedirect::state)
                .containsExactly(RedirectState.ACTIVE, RedirectState.SHADOWED);
    }

    @Test
    void withoutOutputsNothingIsLiveAndNoPageResolves() {
        List<ResolvedRedirect> resolved = RedirectResolver.resolve(List.of(
                RedirectRule.toAsset("html", "", "new/page.html", PAGE, 1),
                RedirectRule.toPath("html", "", "old.html", "new.html")), RedirectOutputs.EMPTY);

        assertThat(resolved).extracting(ResolvedRedirect::state)
                .containsExactly(RedirectState.DANGLING, RedirectState.ACTIVE);
    }

    @Test
    void outputsIndexEveryPageOutputOfAnAsset() {
        assertThat(OUTPUTS.pagesOf(PAGE)).extracting(RedirectOutputs.PageOutput::path)
                .containsExactlyInAnyOrder("new/page.html", "new/page-2.html", "en/new/page.html", "new/page.md");
        assertThat(OUTPUTS.pagesOf(PAGE)).extracting(o -> o.key().locale()).containsOnly("", "en");
        assertThat(OUTPUTS.pagesOf(GONE)).isEmpty();
        assertThat(OUTPUTS.pagePath(PAGE, "html", null, 2)).contains("new/page-2.html");
    }

    @Test
    void aRuleHasExactlyOneTarget() {
        assertThatThrownBy(() -> new RedirectRule(null, "html", "", "a.html", PAGE, 1, "b.html"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RedirectRule(null, "html", "", "a.html", null, null, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(new RedirectRule(null, "html", null, "a.html", PAGE, null, null).pageNumber()).isEqualTo(1);
    }
}
