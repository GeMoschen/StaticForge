package com.acme.staticforge.asset.media;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import org.apache.tika.Tika;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;

class TextMediaTypesTest {

    private final Tika tika = new Tika();

    /**
     * Real sample files through the same detection call as {@code MediaServiceImpl.sniff}: the
     * allow-list must cover what Tika reports, not what we assume. Detection is name-driven; without
     * a name every one of these (except SVG/XML) comes back {@code text/plain}, which is still text.
     */
    @ParameterizedTest
    @CsvSource({
        "sample.css, text/css",
        "sample.js, application/javascript",
        "sample.min.js, application/javascript",
        "sample.json, application/json",
        "site.webmanifest, application/manifest+json",
        "sample.svg, image/svg+xml",
        "sample.txt, text/plain",
        "sample.xml, application/xml",
    })
    void tikaDetectsSamplesAsAllowListedText(String file, String expectedMime) throws IOException {
        String detected = tika.detect(sample(file), file);

        assertThat(detected).isEqualTo(expectedMime);
        assertThat(TextMediaTypes.isText(detected)).isTrue();
    }

    /** Known gap: Tika 2.9 doesn't know {@code .mjs}; it is still text, but published with a {@code .txt} extension. */
    @Test
    void mjsIsDetectedAsPlainText() throws IOException {
        assertThat(tika.detect(sample("sample.mjs"), "sample.mjs")).isEqualTo("text/plain");
    }

    @Test
    void binaryTypesAreNotText() {
        assertThat(TextMediaTypes.isText("image/png")).isFalse();
        assertThat(TextMediaTypes.isText("application/pdf")).isFalse();
        assertThat(TextMediaTypes.isText("application/octet-stream")).isFalse();
        assertThat(TextMediaTypes.isText(null)).isFalse();
    }

    @Test
    void parametersAndCaseAreIgnored() {
        assertThat(TextMediaTypes.isText("Text/CSS; charset=UTF-8")).isTrue();
        assertThat(TextMediaTypes.isScriptLike("application/json;charset=utf-8")).isTrue();
        assertThat(TextMediaTypes.isScriptLike("text/css")).isFalse();
    }

    @Test
    void processedNeedsFlagAndTextType() {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode css = mapper.createObjectNode().put("mimeType", "text/css");
        assertThat(TextMediaTypes.isProcessed(css)).isFalse();
        assertThat(TextMediaTypes.isProcessed(css.deepCopy().put("processCms", true))).isTrue();
        assertThat(TextMediaTypes.isProcessed(
                mapper.createObjectNode().put("mimeType", "image/png").put("processCms", true))).isFalse();
        assertThat(TextMediaTypes.isProcessed(null)).isFalse();
    }

    private static byte[] sample(String name) throws IOException {
        try (InputStream in = TextMediaTypesTest.class.getResourceAsStream("/text-media/" + name)) {
            return in.readAllBytes();
        }
    }
}
