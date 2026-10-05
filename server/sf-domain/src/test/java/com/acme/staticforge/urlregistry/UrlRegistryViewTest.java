package com.acme.staticforge.urlregistry;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link UrlRegistryView}: registered URLs win, first-time URLs are claimed once, a held URL is a collision (M32.3). */
class UrlRegistryViewTest {

    private static final UUID A = UUID.randomUUID();
    private static final UUID B = UUID.randomUUID();
    private static final UUID MEDIA = UUID.randomUUID();

    @Test
    void aRegisteredUrlWinsOverTheComputedOneAndClaimsNothing() {
        UrlRegistryView view = UrlRegistryView.of(List.of(row(UrlTarget.page(A), "html", "old/a.html", true)));

        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "new/a.html")).isEqualTo("old/a.html");
        assertThat(view.claims()).isEmpty();
        assertThat(view.collisions()).isEmpty();
    }

    @Test
    void aFirstTimeUrlIsClaimedOnceAndReturnedAgain() {
        UrlRegistryView view = UrlRegistryView.empty();

        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "a.html")).isEqualTo("a.html");
        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "moved.html")).isEqualTo("a.html");
        assertThat(view.claims()).containsExactly(
                new UrlRegistryView.Claim(new UrlRegistryView.Key(UrlTarget.page(A), "html", ""), "a.html"));
    }

    @Test
    void claimingAUrlAnotherTargetHoldsIsACollision() {
        UrlRegistryView view = UrlRegistryView.of(List.of(row(UrlTarget.page(A), "html", "about.html", true)));

        view.url(UrlTarget.page(B), "html", "", () -> "about.html");

        assertThat(view.collisions()).singleElement().satisfies(collision -> {
            assertThat(collision.holder().target()).isEqualTo(UrlTarget.page(A));
            assertThat(collision.claimant().target()).isEqualTo(UrlTarget.page(B));
            assertThat(collision.holderOverridden()).isTrue();
        });
        assertThat(view.claims()).isEmpty();
    }

    @Test
    void theSameUrlInAnotherChannelOrLanguageIsNoCollision() {
        UrlRegistryView view = UrlRegistryView.of(List.of(row(UrlTarget.page(A), "html", "about.html", false)));

        view.url(UrlTarget.page(B), "amp", "", () -> "about.html");
        view.url(UrlTarget.page(B), "html", "de", () -> "about.html");

        assertThat(view.collisions()).isEmpty();
    }

    @Test
    void mediaRowsIgnoreTheChannel() {
        UrlRegistryView view = UrlRegistryView.of(List.of(row(UrlTarget.media(MEDIA, "thumb"), "", "img/t.jpg", true)));

        assertThat(view.url(UrlTarget.media(MEDIA, "thumb"), "html", "", () -> "x.jpg")).isEqualTo("img/t.jpg");
        assertThat(view.registered(UrlTarget.media(MEDIA, null), "html", "")).isNull();
    }

    private static UrlRegistryView.Key key(UrlTarget target, String channel, String locale) {
        return new UrlRegistryView.Key(target, channel, locale);
    }

    @Test
    void aSeedIsUsedAndClaimedInsteadOfTheComputedUrl() {
        UrlRegistryView view = UrlRegistryView.of(List.of(), Map.of(key(UrlTarget.page(A), "html", ""), "preview/a.html"));

        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "computed/a.html")).isEqualTo("preview/a.html");
        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "other.html")).isEqualTo("preview/a.html");
        assertThat(view.claims()).containsExactly(new UrlRegistryView.Claim(key(UrlTarget.page(A), "html", ""), "preview/a.html"));
        assertThat(view.collisions()).isEmpty();
    }

    @Test
    void aSeedAnotherRegisteredTargetHoldsFallsBackToComputedWithoutACollision() {
        UrlRegistryView view = UrlRegistryView.of(
                List.of(row(UrlTarget.page(B), "html", "a.html", false)),
                Map.of(key(UrlTarget.page(A), "html", ""), "a.html"));

        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "computed/a.html")).isEqualTo("computed/a.html");
        assertThat(view.collisions()).isEmpty();
        assertThat(view.claims()).extracting(UrlRegistryView.Claim::url).containsExactly("computed/a.html");
    }

    @Test
    void aSeedAnEarlierClaimHoldsFallsBackToComputed() {
        UrlRegistryView view = UrlRegistryView.of(List.of(), Map.of(key(UrlTarget.page(A), "html", ""), "x.html"));

        assertThat(view.url(UrlTarget.page(B), "html", "", () -> "x.html")).isEqualTo("x.html");
        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "a.html")).isEqualTo("a.html");
        assertThat(view.collisions()).isEmpty();
    }

    @Test
    void anOverrideAndAnyRegisteredUrlBeatTheSeed() {
        UrlRegistryView view = UrlRegistryView.of(
                List.of(row(UrlTarget.page(A), "html", "manual/a.html", true)),
                Map.of(key(UrlTarget.page(A), "html", ""), "preview/a.html"));

        assertThat(view.url(UrlTarget.page(A), "html", "", () -> "computed/a.html")).isEqualTo("manual/a.html");
        assertThat(view.claims()).isEmpty();
    }

    @Test
    void aSeedOnlyCountsForTheFirstPageOfAPage() {
        UrlRegistryView view = UrlRegistryView.of(List.of(), Map.of(
                key(UrlTarget.page(A, 2), "html", ""), "preview/a-2.html",
                key(UrlTarget.media(MEDIA, "thumb"), "", ""), "preview/t.jpg",
                key(UrlTarget.folder(B), "html", ""), "preview/dir/",
                key(UrlTarget.page(B), "html", ""), " "));

        assertThat(view.url(UrlTarget.page(A, 2), "html", "", () -> "a-2.html")).isEqualTo("a-2.html");
        assertThat(view.url(UrlTarget.media(MEDIA, "thumb"), "", "", () -> "t.jpg")).isEqualTo("t.jpg");
        assertThat(view.url(UrlTarget.folder(B), "html", "", () -> "dir/")).isEqualTo("dir/");
        assertThat(view.url(UrlTarget.page(B), "html", "", () -> "b.html")).isEqualTo("b.html");
    }

    @Test
    void aSeedAppliesOnlyToItsChannelAndLanguage() {
        UrlRegistryView view = UrlRegistryView.of(List.of(), Map.of(key(UrlTarget.page(A), "html", "de"), "de/a.html"));

        assertThat(view.url(UrlTarget.page(A), "amp", "de", () -> "amp/a.html")).isEqualTo("amp/a.html");
        assertThat(view.url(UrlTarget.page(A), "html", "en", () -> "en/a.html")).isEqualTo("en/a.html");
        assertThat(view.url(UrlTarget.page(A), "html", "de", () -> "x.html")).isEqualTo("de/a.html");
    }

    private static UrlRegistryEntry row(UrlTarget target, String channel, String url, boolean overridden) {
        return new UrlRegistryEntry(1L, channel, target, UrlArea.GENERATED, "", url, Instant.now(), 1L, overridden);
    }
}
