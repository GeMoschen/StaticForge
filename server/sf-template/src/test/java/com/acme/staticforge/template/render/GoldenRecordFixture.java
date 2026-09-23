package com.acme.staticforge.template.render;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.octl.CompiledTemplate;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.ReferenceResolver;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The stub content store of the golden-file corpora ({@link GoldenFileRenderTest}, {@link MarkdownChannelGoldenTest}):
 * a case's optional {@code records.json}, plus the {@code references.json} values sharing its reference keys.
 *
 * <p>{@code records.json} maps a dataset uid to
 * {@code {uuid, schema?, recordTemplates?, recordSets?, records: [{uuid, uid, displayName, folderPath, recordSet,
 * changedAt, content}]}}:
 *
 * <ul>
 *   <li>each dataset resolves as {@code dataset:<uid>} and lists its records to loops (M19.3.2); each record resolves
 *       as {@code record:<uid>} and reads as its loop item, also when reached by dereferencing a reference;
 *   <li>{@code schema} (CDL, optional) is the dataset's definition: set queries are compiled against it (without it,
 *       only their grammar is checked) and it is the record templates' scope;
 *   <li>{@code recordTemplates} maps a channel to the dataset's record template source (M25.2.2), compiled like the
 *       pipelines compile it ({@link OctlCompiler#compileRecordTemplate}), once per case and channel;
 *   <li>{@code recordSets} maps a set uid to {@code {uuid, displayName, query: {where, sort, limit, offset},
 *       deleted}}; it resolves as {@code recordset:<uid>} and holds the dataset's records whose {@code recordSet} is
 *       its uid. A {@code deleted} set is missing to the renderer, as a soft-deleted set is in the pipelines.
 * </ul>
 */
final class GoldenRecordFixture {

    private final Map<String, UUID> uuids;
    private final Map<UUID, JsonNode> assetValues;
    private final Map<UUID, List<RecordView>> datasets = new HashMap<>();
    private final Map<UUID, RecordSetSource> recordSets = new HashMap<>();
    private final Map<UUID, Map<String, String>> recordTemplateSources = new HashMap<>();
    private final Map<UUID, ContentDefinition> definitions = new HashMap<>();

    /**
     * @param uuids the case's reference keys → UUIDs, extended with the fixture's datasets, records and sets
     * @param assetValues the case's cross-asset values by UUID, extended with the fixture's records
     */
    GoldenRecordFixture(Map<String, UUID> uuids, Map<UUID, JsonNode> assetValues) {
        this.uuids = uuids;
        this.assetValues = assetValues;
    }

    /** Registers each dataset, record, record set and record template of a {@code records.json} fixture. */
    void load(JsonNode fixture) {
        CdlCompiler cdl = new CdlCompiler();
        fixture.fields().forEachRemaining(entry -> {
            String datasetUid = entry.getKey();
            JsonNode dataset = entry.getValue();
            UUID datasetUuid = UUID.fromString(dataset.path("uuid").asText());
            uuids.put("dataset:" + datasetUid, datasetUuid);
            ContentDefinition definition = dataset.path("schema").isTextual()
                    ? cdl.compile(dataset.path("schema").asText()).definition()
                    : null;
            if (definition != null) {
                definitions.put(datasetUuid, definition);
            }
            List<RecordView> records = new ArrayList<>();
            for (JsonNode record : dataset.path("records")) {
                RecordView view = new RecordView(
                        UUID.fromString(record.path("uuid").asText()),
                        record.path("uid").asText(),
                        record.path("displayName").asText(),
                        record.path("folderPath").asText("/"),
                        record.path("recordSet").asText(null),
                        Instant.parse(record.path("changedAt").asText("2026-01-01T00:00:00Z")),
                        record.path("content"));
                records.add(view);
                uuids.put("record:" + view.uid(), view.uuid());
                assetValues.put(view.uuid(), view.item());
            }
            datasets.put(datasetUuid, records);

            Map<String, String> templates = new HashMap<>();
            dataset.path("recordTemplates").fields().forEachRemaining(t -> templates.put(t.getKey(), t.getValue().asText()));
            recordTemplateSources.put(datasetUuid, templates);

            dataset.path("recordSets").fields().forEachRemaining(set -> {
                UUID setUuid = UUID.fromString(set.getValue().path("uuid").asText());
                uuids.put("recordset:" + set.getKey(), setUuid);
                if (set.getValue().path("deleted").asBoolean(false)) {
                    return;
                }
                List<RecordView> members = records.stream().filter(r -> set.getKey().equals(r.recordSet())).toList();
                recordSets.put(setUuid, new RecordSetSource(
                        setUuid,
                        set.getKey(),
                        set.getValue().path("displayName").asText(set.getKey()),
                        datasetUuid,
                        datasetUid,
                        RecordSetQueries.compile(RecordSetQuery.fromJson(set.getValue().path("query")), definition),
                        definition,
                        members));
            });
        });
    }

    /** The compile-time resolver over every registered reference key, or {@code null} when there is none. */
    ReferenceResolver references() {
        return uuids.isEmpty() ? null : (assetType, uid) -> java.util.Optional.ofNullable(uuids.get(assetType + ":" + uid));
    }

    /** Whether the case has anything a cross-asset value can read. */
    boolean hasValues() {
        return !assetValues.isEmpty() || !recordSets.isEmpty();
    }

    /** Whether the case has a {@code records.json}. */
    boolean hasRecords() {
        return !datasets.isEmpty();
    }

    /** The render-time value resolver: stub values, dataset records and record sets. */
    AssetValueResolver assetValueResolver() {
        return new AssetValueResolver() {
            @Override
            public JsonNode valueOf(String assetType, UUID uuid) {
                return assetValues.getOrDefault(uuid, MissingNode.getInstance());
            }

            @Override
            public List<RecordView> datasetRecords(UUID datasetUuid) {
                return datasets.getOrDefault(datasetUuid, List.of());
            }

            @Override
            public RecordSetSource recordSet(UUID setUuid) {
                return recordSets.get(setUuid);
            }
        };
    }

    /** The block resolver supplying the datasets' record templates for {@code channel}, compiled once each. */
    BlockResolver blockResolver(OctlCompiler compiler, String channel) {
        Map<UUID, CompiledTemplate> compiled = new HashMap<>();
        return new BlockResolver() {
            @Override
            public String renderBody(String bodyName) {
                return "";
            }

            @Override
            public String renderInclude(String uid, Map<String, String> args) {
                return "";
            }

            @Override
            public CompiledTemplate recordTemplate(UUID datasetUuid) {
                String source = recordTemplateSources.getOrDefault(datasetUuid, Map.of()).get(channel);
                if (source == null) {
                    return null;
                }
                return compiled.computeIfAbsent(datasetUuid, uuid -> {
                    var result = compiler.compileRecordTemplate(source, channel, references(), definitions.get(uuid));
                    if (result.diagnostics().stream().anyMatch(d -> d.severity() == Severity.ERROR)) {
                        throw new AssertionError("record template errors: " + result.diagnostics());
                    }
                    return result.template();
                });
            }
        };
    }
}
