package com.acme.staticforge.template.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import net.jqwik.api.constraints.IntRange;

/** {@code M19.3.1}: {@code apply} is deterministic and never exceeds its bounds. */
class DatasetQueryPropertiesTest {

    @Property(tries = 200)
    void sameInputSameOrderWhateverTheInputOrder(
            @ForAll("records") List<RecordView> records, @ForAll("sorts") String sort, @ForAll long seed) {
        DatasetQuery query = DatasetQueryParser.parse(java.util.Map.of("sort", sort), "r", 1, 1).query();
        List<RecordView> shuffled = new ArrayList<>(records);
        Collections.shuffle(shuffled, new java.util.Random(seed));

        List<UUID> first = uuids(DatasetQueryEvaluator.apply(records, query, null));
        List<UUID> second = uuids(DatasetQueryEvaluator.apply(shuffled, query, null));

        assertThat(second).isEqualTo(first);
        assertThat(first).hasSize(records.size());
    }

    @Property(tries = 200)
    void limitAndOffsetStayInBounds(
            @ForAll("records") List<RecordView> records,
            @ForAll @IntRange(min = 0, max = 60) int offset,
            @ForAll @IntRange(min = 0, max = 60) int limit) {
        DatasetQuery all = DatasetQuery.all("r");
        DatasetQuery page = new DatasetQuery("r", null, List.of(), limit, offset, null);

        List<RecordView> everything = DatasetQueryEvaluator.apply(records, all, null);
        List<RecordView> slice = DatasetQueryEvaluator.apply(records, page, null);

        int expectedSize = Math.max(0, Math.min(limit, records.size() - offset));
        assertThat(slice).hasSize(expectedSize);
        if (expectedSize > 0) {
            assertThat(slice).isEqualTo(everything.subList(offset, offset + expectedSize));
        }
    }

    @Provide
    Arbitrary<List<RecordView>> records() {
        Arbitrary<String> names = Arbitraries.of("Ada", "ada", "Bob", "", "Zoë", "émile", "2024-01-01");
        Arbitrary<Object> values = Arbitraries.oneOf(
                Arbitraries.integers().between(-5, 5).map(i -> (Object) i),
                Arbitraries.of("x", "Y", "2024-02-03", "2024-02-03T10:00:00Z").map(s -> (Object) s),
                Arbitraries.of(true, false).map(b -> (Object) b),
                Arbitraries.just((Object) "__missing__"));
        Arbitrary<RecordView> record = Combinators.combine(names, values, values, Arbitraries.integers().between(0, 1_000_000))
                .as((name, a, b, n) -> {
                    ObjectNode content = JsonNodeFactory.instance.objectNode();
                    put(content, "a", a);
                    put(content, "b", b);
                    return new RecordView(UUID.randomUUID(), "r" + n, name, "/", "set", Instant.EPOCH, content);
                });
        // uids are unique per project in the real store
        return record.list().ofMaxSize(40).uniqueElements(RecordView::uid);
    }

    @Provide
    Arbitrary<String> sorts() {
        return Arbitraries.of("a", "-a", "b,a", "-b,-a", "_displayName", "-_uid", "a,-_displayName");
    }

    private static void put(ObjectNode content, String field, Object value) {
        switch (value) {
            case Integer i -> content.put(field, i);
            case Boolean b -> content.put(field, b);
            case String s when !"__missing__".equals(s) -> content.put(field, s);
            default -> { /* missing */ }
        }
    }

    private static List<UUID> uuids(List<RecordView> records) {
        return records.stream().map(RecordView::uuid).toList();
    }
}
