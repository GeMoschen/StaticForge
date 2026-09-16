package com.acme.staticforge.asset.media;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class MediaPathsTest {

    @ParameterizedTest
    @CsvSource({
        "image/jpeg, jpg", "image/jpg, jpg", "image/png, png", "image/webp, webp", "image/gif, gif",
        "image/svg+xml, svg", "image/avif, avif", "video/mp4, mp4", "video/webm, webm", "audio/mpeg, mp3",
        "audio/ogg, ogg", "application/pdf, pdf", "text/css, css", "application/javascript, js",
        "text/javascript, js", "font/ttf, ttf", "font/otf, otf", "font/woff, woff", "font/woff2, woff2",
        "text/plain, txt", "application/octet-stream, bin",
    })
    void previouslyMappedTypesAreUnchanged(String mime, String ext) {
        assertThat(MediaPaths.extensionFor(mime)).isEqualTo(ext);
    }

    @ParameterizedTest
    @CsvSource({
        "application/json, json", "application/manifest+json, webmanifest", "application/xml, xml", "text/xml, xml",
    })
    void textDataTypesGetTheirOwnExtension(String mime, String ext) {
        assertThat(MediaPaths.extensionFor(mime)).isEqualTo(ext);
    }

    @Test
    void everyTextMediaTypeHasARealExtension() {
        for (String mime : TextMediaTypes.ALL) {
            assertThat(MediaPaths.extensionFor(mime)).as(mime).isNotEqualTo("bin");
        }
        assertThat(MediaPaths.extensionFor(null)).isEqualTo("bin");
    }
}
