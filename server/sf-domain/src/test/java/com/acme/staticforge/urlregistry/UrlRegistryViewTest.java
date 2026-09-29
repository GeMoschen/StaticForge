package com.acme.staticforge.urlregistry;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
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

    private static UrlRegistryEntry row(UrlTarget target, String channel, String url, boolean overridden) {
        return new UrlRegistryEntry(1L, channel, target, UrlArea.GENERATED, "", url, Instant.now(), 1L, overridden);
    }
}
