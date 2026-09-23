package com.acme.staticforge.generate.plan;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.generate.snapshot.SnapshotAsset;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.query.DatasetQuery;
import com.acme.staticforge.template.query.DatasetQueryEvaluator;
import com.acme.staticforge.template.query.RecordView;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Which record changes a template's dataset loops render (M19.3.2), for one incremental plan.
 *
 * <p>A template — or a dataset's record template (M25.2.3), which renders once per record of the dataset's sets — reads
 * a dataset's records only through {@code $CMS_FOR(x : dataset:uid, …)$} loops, and
 * a loop's output depends only on the records its {@code folder} and {@code where} select: sorting,
 * {@code offset}, {@code limit} and {@code _count} all come after the filter. So a record change can
 * alter a loop only if the record version before or after the change passes that filter
 * ({@link DatasetQueryEvaluator#maySelect}, which assumes the worst for a {@code where} that reads the
 * render scope).
 *
 * <p>Whatever can't be analysed counts as reading every record: a template with a reference edge to
 * the dataset but no loop spelling its current uid (a uid renamed since the save, a source that no
 * longer parses). Templates are compiled here without a resolver — loops are found by uid — at most
 * once per (template, dataset) per plan.
 */
final class DatasetLoopImpact {

    /** Stands in for a template that can't be analysed: selects every record. */
    private static final List<DatasetQuery> EVERY_RECORD = List.of(DatasetQuery.all(null));

    private final OctlCompiler compiler = new OctlCompiler();
    private final Map<LoopsKey, List<DatasetQuery>> loops = new HashMap<>();

    /** Whether any loop of {@code template} over {@code dataset} may select one of {@code records}. */
    boolean affects(SnapshotAsset template, SnapshotAsset dataset, List<RecordView> records) {
        List<DatasetQuery> queries = loops.computeIfAbsent(
                new LoopsKey(template.assetId(), dataset.uid()), key -> loopsOver(template, dataset.uid()));
        for (DatasetQuery query : queries) {
            for (RecordView record : records) {
                if (DatasetQueryEvaluator.maySelect(record, query)) {
                    return true;
                }
            }
        }
        return false;
    }

    private List<DatasetQuery> loopsOver(SnapshotAsset template, String datasetUid) {
        JsonNode channels = template.payload() == null ? null : template.payload().path("channelTemplates");
        if (datasetUid == null || channels == null || !channels.isObject()) {
            return EVERY_RECORD;
        }
        List<DatasetQuery> queries = new ArrayList<>();
        for (Iterator<Map.Entry<String, JsonNode>> it = channels.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> channel = it.next();
            String source = channel.getValue().path("source").asText("");
            if (!source.isBlank()) {
                var compiled = template.type() == AssetType.DATASET
                        ? compiler.compileRecordTemplate(source, channel.getKey(), null, null)
                        : compiler.compile(source, channel.getKey(), null);
                queries.addAll(compiled.template().datasetQueries(datasetUid));
            }
        }
        return queries.isEmpty() ? EVERY_RECORD : List.copyOf(queries);
    }

    private record LoopsKey(long templateAssetId, String datasetUid) {}
}
