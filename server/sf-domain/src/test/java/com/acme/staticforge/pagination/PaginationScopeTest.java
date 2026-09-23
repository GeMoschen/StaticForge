package com.acme.staticforge.pagination;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The {@code CMS_PAGINATION} value (M21.3.1): slices, counts and links on first, middle, last and empty pages. */
class PaginationScopeTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final PaginationScope.Links links = new PaginationScope.Links() {
        @Override
        public String page(int number) {
            return "p" + number;
        }

        @Override
        public String item(PaginationItem item) {
            return "posts/" + item.uid();
        }
    };

    @Test
    void buildsTheMiddlePage() {
        JsonNode scope = PaginationScope.build(items(25), 10, 2, links, item -> MAPPER.createObjectNode().put("teaser", item.uid()));

        assertThat(scope.path("items")).hasSize(10);
        assertThat(scope.path("items").get(0).path("uid").asText()).isEqualTo("post10");
        assertThat(scope.path("items").get(0).path("href").asText()).isEqualTo("posts/post10");
        assertThat(scope.path("items").get(0).path("content").path("teaser").asText()).isEqualTo("post10");
        assertThat(scope.path("items").get(0).path("date").asText()).isEqualTo("2026-01-10");
        assertThat(scope.path("current").asInt()).isEqualTo(2);
        assertThat(scope.path("total").asInt()).isEqualTo(3);
        assertThat(scope.path("pageSize").asInt()).isEqualTo(10);
        assertThat(scope.path("itemCount").asInt()).isEqualTo(25);
        assertThat(scope.path("firstHref").asText()).isEqualTo("p1");
        assertThat(scope.path("prevHref").asText()).isEqualTo("p1");
        assertThat(scope.path("nextHref").asText()).isEqualTo("p3");
        assertThat(scope.path("lastHref").asText()).isEqualTo("p3");
        assertThat(scope.path("canonicalHref").asText()).isEqualTo("p2");
        assertThat(scope.path("pages")).hasSize(3);
        assertThat(scope.path("pages").get(1).path("current").asBoolean()).isTrue();
        assertThat(scope.path("pages").get(2).path("href").asText()).isEqualTo("p3");
    }

    @Test
    void firstAndLastPagesHaveNoPrevOrNext() {
        JsonNode first = PaginationScope.build(items(25), 10, 1, links, item -> null);
        JsonNode last = PaginationScope.build(items(25), 10, 3, links, item -> null);

        assertThat(first.path("prevHref").asText()).isEmpty();
        assertThat(first.path("nextHref").asText()).isEqualTo("p2");
        assertThat(last.path("items")).hasSize(5);
        assertThat(last.path("prevHref").asText()).isEqualTo("p2");
        assertThat(last.path("nextHref").asText()).isEmpty();
        assertThat(first.path("items").get(0).path("content").isObject()).isTrue();
    }

    @Test
    void anEmptySourceIsOneEmptyPage() {
        JsonNode scope = PaginationScope.build(List.of(), 10, 1, links, item -> null);

        assertThat(scope.path("items")).isEmpty();
        assertThat(scope.path("total").asInt()).isEqualTo(1);
        assertThat(scope.path("prevHref").asText()).isEmpty();
        assertThat(scope.path("nextHref").asText()).isEmpty();
        assertThat(scope.path("pages")).hasSize(1);
    }

    @Test
    void recordItemsAreTheRecordFields() {
        ObjectNode content = MAPPER.createObjectNode().put("title", "Hello").put("label", "own label");
        RecordView record = new RecordView(UUID.randomUUID(), "hello", "Hello record", "/", "greetings", Instant.EPOCH, content);
        PaginationItem item = new PaginationItem(
                record.uuid(), record.uid(), record.displayName(), record.displayName(), null, 0, null, record);

        JsonNode node = PaginationScope.build(List.of(item), 10, 1, links, i -> null).path("items").get(0);

        assertThat(node.path("title").asText()).isEqualTo("Hello");
        assertThat(node.path("_uid").asText()).isEqualTo("hello");
        assertThat(node.path("uid").asText()).isEqualTo("hello");
        assertThat(node.path("uuid").asText()).isEqualTo(record.uuid().toString());
        assertThat(node.path("displayName").asText()).isEqualTo("Hello record");
        assertThat(node.path("label").asText()).isEqualTo("own label");
        assertThat(node.has("href")).isFalse();
    }

    private static List<PaginationItem> items(int count) {
        List<PaginationItem> items = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            String uid = "post" + i;
            items.add(new PaginationItem(
                    UUID.randomUUID(), uid, "Post " + i, "Post " + i, "2026-01-" + String.format("%02d", i), i,
                    UUID.randomUUID(), null));
        }
        return items;
    }
}
