package com.acme.staticforge.channel;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.channel.ChannelOutputSettings.FieldError;
import com.acme.staticforge.channel.ChannelOutputSettings.UrlStrategy;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** Parsing (lenient) and validation (strict) of {@link ChannelOutputSettings}. */
class ChannelOutputSettingsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void defaultsMatchTheSeededHtmlChannel() throws Exception {
        ChannelOutputSettings seeded = ChannelOutputSettings.of(
                "html", "html", MAPPER.readTree("{\"indexFileName\":\"index.html\",\"urlStrategy\":\"RELATIVE\"}"));

        assertThat(seeded).isEqualTo(ChannelOutputSettings.defaults("html"));
        assertThat(seeded.indexUid()).isEqualTo("index");
        assertThat(seeded.indexFileName()).isEqualTo("index.html");
        assertThat(seeded.urlStrategy()).isEqualTo(UrlStrategy.RELATIVE);
        assertThat(seeded.trailingSlash()).isFalse();
        assertThat(seeded.directoryUrls()).isFalse();
    }

    @Test
    void parsesAllKnownKeysAndIgnoresUnknownOnes() throws Exception {
        ChannelOutputSettings settings = ChannelOutputSettings.of("html", "htm", MAPPER.readTree(
                "{\"indexUid\":\"home\",\"indexFileName\":\"default.htm\",\"urlStrategy\":\"PRETTY\","
                        + "\"trailingSlash\":true,\"prettyPrint\":true,\"minify\":false}"));

        assertThat(settings).isEqualTo(new ChannelOutputSettings("htm", "home", "default.htm", UrlStrategy.PRETTY, true));
        assertThat(settings.indexStem()).isEqualTo("default");
        assertThat(settings.directoryUrls()).isTrue();
    }

    @Test
    void parsingFallsBackToDefaultsForUnusableValues() throws Exception {
        ChannelOutputSettings settings = ChannelOutputSettings.of("markdown", "Not An Ext", MAPPER.readTree(
                "{\"indexFileName\":\"bad/name\",\"urlStrategy\":\"NICE\",\"trailingSlash\":\"yes\"}"));

        assertThat(settings).isEqualTo(ChannelOutputSettings.defaults("markdown"));
        assertThat(settings.extension()).isEqualTo("md");
        assertThat(settings.indexFileName()).isEqualTo("index.md");
    }

    @Test
    void validationAcceptsBlankAndWellFormedValues() throws Exception {
        assertThat(ChannelOutputSettings.validate(null, null)).isEmpty();
        assertThat(ChannelOutputSettings.validate("", MAPPER.createObjectNode())).isEmpty();
        assertThat(ChannelOutputSettings.validate("htm", MAPPER.readTree(
                        "{\"indexUid\":\"home\",\"indexFileName\":\"index.html\",\"urlStrategy\":\"PRETTY\","
                                + "\"trailingSlash\":true,\"prettyPrint\":true}")))
                .isEmpty();
    }

    @Test
    void validationReportsEachInvalidField() {
        ObjectNode settings = MAPPER.createObjectNode()
                .put("urlStrategy", "NICE")
                .put("indexFileName", "../index.html")
                .put("trailingSlash", "true");
        settings.putArray("indexUid");

        assertThat(ChannelOutputSettings.validate("HTML", settings))
                .extracting(FieldError::field)
                .containsExactly(
                        "fileExtension",
                        "settings.urlStrategy",
                        "settings.indexFileName",
                        "settings.indexUid",
                        "settings.trailingSlash");
    }
}
