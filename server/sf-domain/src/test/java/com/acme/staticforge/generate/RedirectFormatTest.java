package com.acme.staticforge.generate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Set;
import org.junit.jupiter.api.Test;

class RedirectFormatTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void withoutTheKeyATargetWritesHtmlStubsAndAnEmptyListWritesNothing() throws Exception {
        assertThat(RedirectFormat.of(null)).containsExactly(RedirectFormat.HTML_STUB);
        assertThat(RedirectFormat.of(config("{\"baseUrl\":\"https://example.com\"}"))).containsExactly(RedirectFormat.HTML_STUB);
        assertThat(RedirectFormat.of(config("{\"redirectFormats\":null}"))).containsExactly(RedirectFormat.HTML_STUB);
        assertThat(RedirectFormat.of(config("{\"redirectFormats\":[]}"))).isEmpty();
        assertThat(RedirectFormat.of(config("{\"redirectFormats\":[\"JSON\",\"htaccess\",\"NGINX\",3]}")))
                .isEqualTo(Set.of(RedirectFormat.JSON, RedirectFormat.HTACCESS));
    }

    @Test
    void validationAcceptsDistinctKnownNamesOnly() throws Exception {
        assertThatCode(() -> RedirectFormat.validate(config("{}"))).doesNotThrowAnyException();
        assertThatCode(() -> RedirectFormat.validate(config("{\"redirectFormats\":[\"HTML_STUB\",\"HTACCESS\",\"JSON\"]}")))
                .doesNotThrowAnyException();
        assertThatCode(() -> RedirectFormat.validate(config("{\"redirectFormats\":[]}"))).doesNotThrowAnyException();
        assertThatThrownBy(() -> RedirectFormat.validate(config("{\"redirectFormats\":\"JSON\"}")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("must be an array");
        assertThatThrownBy(() -> RedirectFormat.validate(config("{\"redirectFormats\":[\"NGINX\"]}")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Unknown redirect format");
        assertThatThrownBy(() -> RedirectFormat.validate(config("{\"redirectFormats\":[\"JSON\",\"json\"]}")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("listed twice");
    }

    private static JsonNode config(String json) throws Exception {
        return MAPPER.readTree(json);
    }
}
