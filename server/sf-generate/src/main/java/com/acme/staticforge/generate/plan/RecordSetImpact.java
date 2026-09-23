package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.dataset.RecordValues;
import com.acme.staticforge.asset.template.TemplateCompileMemo;
import com.acme.staticforge.generate.snapshot.Snapshot;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.RecordSetReads;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.RecordSetQueries;
import com.acme.staticforge.template.query.RecordSetQuery;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Which record changes and record template changes the readers of a record set render (M25.2.3), for one incremental
 * plan.
 *
 * <p>A reader sees a set's records only through what the set's stored query selects (epic decision 5): its
 * {@code where} filters before sorting, {@code offset}, {@code limit} and {@code _count}, so a record the query can't
 * select before or after a change doesn't alter the reader. The stored query reads no render scope, so this is always
 * decidable ({@link RecordSetQueries#maySelect}, against every language of the project). A template's loop over the
 * set AND-s its own {@code where}, which prunes further unless it reads the render scope.
 *
 * <p>Readers come in two kinds:
 * <ul>
 *   <li><b>OCTL readers</b> — page and section templates and datasets (their record templates) spelling
 *       {@code recordset:uid}: their loops and value reads are found by the uid as spelled
 *       ({@link com.acme.staticforge.template.octl.CompiledTemplate#recordSetReads}), compiled here without a resolver
 *       at most once per (reader, set) per plan. A reader that doesn't spell the set's current uid (renamed since the
 *       save) and processed text media (a source this plan doesn't read) count as value readers without narrowing.</li>
 *   <li><b>Content readers</b> — pages, records and global sets whose {@code reference} editor points at the set. The
 *       template that renders the editor is not analysed: the set's own query still prunes, a loop's narrowing
 *       doesn't, and the reader counts as rendering the records through the record template.</li>
 * </ul>
 *
 * <p>The set's query is compiled against its dataset's schema from the build's compile memo — the same schema
 * instance generation renders with — so a query that no longer validates selects nothing here either.
 */
final class RecordSetImpact {

    /** A value read: the set's query alone decides. */
    private static final List<DatasetQuery> SET_QUERY_ONLY = Arrays.asList((DatasetQuery) null);

    private final OctlCompiler compiler = new OctlCompiler();
    private final Snapshot snapshot;
    private final TemplateCompileMemo definitions;
    private final List<List<String>> localeChains;
    private final Map<Long, RecordSetQueries.Compiled> queries = new HashMap<>();
    private final Map<ReadsKey, RecordSetReads> reads = new HashMap<>();

    RecordSetImpact(Snapshot snapshot, TemplateCompileMemo definitions, LocaleConfig locales) {
        this.snapshot = snapshot;
        this.definitions = definitions;
        LocaleConfig config = LocaleConfig.orEmpty(locales);
        this.localeChains = config.codes().stream().map(config::effectiveChain).toList();
    }

    /** Whether {@code reader} may render one of {@code records} (versions of one record) as a member of {@code set}. */
    boolean selects(SnapshotAsset reader, SnapshotAsset set, List<RecordView> records) {
        RecordSetQueries.Compiled query = query(set);
        for (DatasetQuery narrowing : narrowings(reader, set)) {
            for (RecordView record : records) {
                if (RecordSetQueries.maySelect(record, query, narrowing, localeChains)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Whether {@code reader} renders {@code set}'s records through the dataset's record template: an OCTL reader with a
     * value read of the set (a loop binds the records and brings its own markup), every content reader.
     */
    boolean rendersRecords(SnapshotAsset reader, SnapshotAsset set) {
        return !isOctlReader(reader) || reads(reader, set).valueReads();
    }

    /** The narrowings the reader applies to the set's selection: {@code null} for a value read, a loop's arguments. */
    private List<DatasetQuery> narrowings(SnapshotAsset reader, SnapshotAsset set) {
        if (!isOctlReader(reader)) {
            return SET_QUERY_ONLY;
        }
        RecordSetReads found = reads(reader, set);
        if (!found.valueReads()) {
            return found.loops();
        }
        List<DatasetQuery> narrowings = new ArrayList<>(found.loops().size() + 1);
        narrowings.add(null);
        narrowings.addAll(found.loops());
        return narrowings;
    }

    private static boolean isOctlReader(SnapshotAsset reader) {
        return reader.type() == AssetType.PAGE_TEMPLATE
                || reader.type() == AssetType.SECTION_TEMPLATE
                || reader.type() == AssetType.DATASET
                || reader.type() == AssetType.MEDIA;
    }

    private RecordSetReads reads(SnapshotAsset reader, SnapshotAsset set) {
        return reads.computeIfAbsent(new ReadsKey(reader.assetId(), set.assetId()), key -> readsOf(reader, set.uid()));
    }

    /** Every channel's reads of the set, merged; a reader whose sources don't spell the uid reads it by value. */
    private RecordSetReads readsOf(SnapshotAsset reader, String setUid) {
        JsonNode channels = reader.payload() == null ? null : reader.payload().path("channelTemplates");
        if (reader.type() == AssetType.MEDIA || setUid == null || channels == null || !channels.isObject()) {
            return new RecordSetReads(List.of(), true);
        }
        List<DatasetQuery> loops = new ArrayList<>();
        boolean valueReads = false;
        for (Iterator<Map.Entry<String, JsonNode>> it = channels.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> channel = it.next();
            String source = channel.getValue().path("source").asText("");
            if (source.isBlank()) {
                continue;
            }
            RecordSetReads found = (reader.type() == AssetType.DATASET
                            ? compiler.compileRecordTemplate(source, channel.getKey(), null, null)
                            : compiler.compile(source, channel.getKey(), null))
                    .template()
                    .recordSetReads(setUid);
            loops.addAll(found.loops());
            valueReads |= found.valueReads();
        }
        return loops.isEmpty() && !valueReads ? new RecordSetReads(List.of(), true) : new RecordSetReads(loops, valueReads);
    }

    /** The set's stored query, compiled against its dataset's schema once per plan. */
    private RecordSetQueries.Compiled query(SnapshotAsset set) {
        return queries.computeIfAbsent(set.assetId(), id -> {
            JsonNode payload = set.payload();
            UUID datasetUuid = RecordValues.datasetRef(payload);
            SnapshotAsset dataset = datasetUuid == null ? null : snapshot.assetByUuid(datasetUuid);
            ContentDefinition definition = dataset == null || dataset.payload() == null
                    ? null
                    : definitions.definition(datasetUuid, dataset.payload().path("contentDefinition").asText(""));
            return RecordSetQueries.compile(
                    RecordSetQuery.fromJson(payload == null ? null : payload.get("query")), definition);
        });
    }

    private record ReadsKey(long readerAssetId, long setAssetId) {}
}
