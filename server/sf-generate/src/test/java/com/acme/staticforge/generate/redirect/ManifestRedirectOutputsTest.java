package com.acme.staticforge.generate.redirect;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.generate.target.BuildManifest.Kind;
import com.acme.staticforge.generate.target.BuildManifest.Output;
import com.acme.staticforge.redirect.RedirectOutputs;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ManifestRedirectOutputsTest {

    private static final UUID PAGE = UUID.fromString("00000000-0000-7000-8000-00000000000a");
    private static final UUID MEDIA = UUID.fromString("00000000-0000-7000-8000-00000000000b");

    @Test
    void pagesAreKeyedMediaIsLiveSiteFilesAreNeither() {
        BuildManifest manifest = new BuildManifest(BuildManifest.VERSION, 5, 3, 3, Set.of("html"), List.of(
                new Output("de/liste.html", Kind.PAGE, PAGE, "html", null, "de", Set.of()),
                new Output("de/liste-2.html", Kind.PAGE, PAGE, "html", 2, "de", Set.of()),
                new Output("list.html", Kind.PAGE, PAGE, "html", null, null, Set.of()),
                new Output("media/logo.png", Kind.MEDIA, MEDIA, null, null, null, Set.of()),
                new Output("sitemap.xml", Kind.SITE, null, null, null, null, Set.of()),
                new Output("old.html", Kind.SITE, null, null, null, null, Set.of())));

        RedirectOutputs outputs = ManifestRedirectOutputs.of(manifest);

        assertThat(outputs.pagePath(PAGE, "html", "de", 1)).contains("de/liste.html");
        assertThat(outputs.pagePath(PAGE, "html", "de", 2)).contains("de/liste-2.html");
        assertThat(outputs.pagePath(PAGE, "html", "", 1)).as("no locale reads as ''").contains("list.html");
        assertThat(outputs.pagePath(PAGE, "md", "de", 1)).isEmpty();
        assertThat(outputs.pagesOf(PAGE)).hasSize(3);
        assertThat(outputs.pagesOf(MEDIA)).isEmpty();
        assertThat(outputs.isLive("de/liste.html")).isTrue();
        assertThat(outputs.isLive("media/logo.png")).isTrue();
        assertThat(outputs.isLive("sitemap.xml")).isFalse();
        assertThat(outputs.isLive("old.html")).as("a redirect stub of the build").isFalse();
    }
}
