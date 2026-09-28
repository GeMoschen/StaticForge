package com.acme.staticforge.generate.quality;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The sidecar's streaming codec (M30.1.3 performance) writes exactly what data binding of the annotated records wrote —
 * so sidecars of earlier builds and new ones are the same format — and reads both back to equal records.
 */
class QualitySidecarJsonTest {

    /** How the sidecar was written and read before the streaming codec: data binding of the annotated records. */
    private static final ObjectMapper DATA_BINDING = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            .setSerializationInclusion(JsonInclude.Include.NON_NULL);

    private static final UUID TEAM = UUID.fromString("2f7c6f0e-6f39-4d3e-9d7e-0b8f4c1f9a11");

    private static QualitySidecar everyField() {
        LinkRef canonical = new LinkRef("link", "href", "https://example.com/a.html", "a.html", null, "head > link");
        HtmlFacts full = new HtmlFacts(
                "A \"quoted\" title — ü",
                "Description",
                2,
                "de-CH",
                canonical,
                List.of(new HtmlFacts.Alternate("en", new LinkRef("link", "href", "en/a.html", "en/a.html", null,
                                "head > link:nth-of-type(2)")),
                        new HtmlFacts.Alternate(null, null)),
                "noindex, nofollow",
                List.of("main", "main", "x\ty"),
                List.of("top"),
                List.of(new LinkRef("a", "href", "b.html#sec", "b.html", "sec", "main#main > a"),
                        new LinkRef("a", "href", "#", null, "", "main#main > a:nth-of-type(2)"),
                        new LinkRef("img", "srcset", "https://other.org/x.png", null, null, "img")),
                true,
                true);
        HtmlFacts minimal = new HtmlFacts(null, null, 0, null, null, List.of(), null, List.of(), List.of(), List.of(),
                false, false);
        return new QualitySidecar(QualitySidecar.VERSION, "fingerprint", Map.of(
                "a.html", new QualitySidecar.Entry(full,
                        List.of(new QualitySidecar.PageFinding("SF-CHK-0202", QualityCategory.SEO, QualitySeverity.ERROR,
                                        "Title \"A\" is too short.", "head > title", "section-1"),
                                new QualitySidecar.PageFinding("SF-CHK-0203", QualityCategory.SEO,
                                        QualitySeverity.WARNING, "No description.", null, null)),
                        List.of(new ReferenceEvent(ReferenceEvent.Kind.UNRELEASED, "page", TEAM, "team", "de",
                                        "content.cta"),
                                new ReferenceEvent(ReferenceEvent.Kind.MISSING, "media", TEAM, null, null, null))),
                "b.html", new QualitySidecar.Entry(minimal, List.of()),
                "c.html", new QualitySidecar.Entry(null, List.of(), List.of())));
    }

    @Test
    void writesExactlyWhatDataBindingWrote() throws Exception {
        QualitySidecar sidecar = everyField();

        assertThat(new String(sidecar.toJson(), StandardCharsets.UTF_8))
                .isEqualTo(DATA_BINDING.writeValueAsString(sidecar));
        QualitySidecar withoutFingerprint = new QualitySidecar(QualitySidecar.VERSION, null, Map.of());
        assertThat(new String(withoutFingerprint.toJson(), StandardCharsets.UTF_8))
                .isEqualTo(DATA_BINDING.writeValueAsString(withoutFingerprint));
    }

    @Test
    void readsItsOwnAndDataBoundSidecarsToEqualRecords() throws Exception {
        QualitySidecar sidecar = everyField();

        assertThat(QualitySidecar.parse(sidecar.toJson())).contains(sidecar);
        assertThat(QualitySidecar.parse(DATA_BINDING.writeValueAsBytes(sidecar))).contains(sidecar);
        assertThat(QualitySidecar.parse(sidecar.toJson()).orElseThrow())
                .isEqualTo(DATA_BINDING.readValue(sidecar.toJson(), QualitySidecar.class));
    }

    @Test
    void ignoresUnknownFieldsAndRejectsWhatIsNoSidecar() {
        String withExtras = """
                {"version":1,"future":{"a":[1,2]},"configFingerprint":"f","outputs":{"a.html":{"facts":{"title":"T",
                "h1Count":1,"extra":[{"x":null}],"idsTruncated":false},"note":"x"}}}""";
        QualitySidecar read = QualitySidecar.parse(withExtras.getBytes(StandardCharsets.UTF_8)).orElseThrow();
        assertThat(read.configFingerprint()).isEqualTo("f");
        assertThat(read.entry("a.html").orElseThrow().facts().title()).isEqualTo("T");
        assertThat(read.entry("a.html").orElseThrow().facts().h1Count()).isEqualTo(1);

        byte[] json = everyField().toJson();
        assertThat(QualitySidecar.parse(Arrays.copyOf(json, json.length / 2))).as("truncated").isEmpty();
        assertThat(QualitySidecar.parse("[]".getBytes(StandardCharsets.UTF_8))).isEmpty();
        assertThat(QualitySidecar.parse("{\"version\":2,\"outputs\":{}}".getBytes(StandardCharsets.UTF_8)))
                .as("another version").isEmpty();
        assertThat(QualitySidecar.parse(
                        "{\"version\":1,\"outputs\":{\"a.html\":{\"findings\":[{\"severity\":\"LOUD\"}]}}}"
                                .getBytes(StandardCharsets.UTF_8)))
                .as("unknown severity").isEmpty();
        assertThat(QualitySidecar.parse(
                        "{\"version\":1,\"outputs\":{\"a.html\":{\"references\":[{\"targetKind\":\"page\"}]}}}"
                                .getBytes(StandardCharsets.UTF_8)))
                .as("an event without its kind").isEmpty();
    }
}
