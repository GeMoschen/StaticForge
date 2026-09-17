package com.acme.staticforge.search;

import com.acme.staticforge.asset.AssetType;
import java.io.IOException;
import java.util.Collection;
import java.util.EnumMap;
import java.util.Map;
import org.apache.lucene.index.DocValues;
import org.apache.lucene.index.LeafReaderContext;
import org.apache.lucene.index.SortedSetDocValues;
import org.apache.lucene.search.Collector;
import org.apache.lucene.search.CollectorManager;
import org.apache.lucene.search.LeafCollector;
import org.apache.lucene.search.Scorable;
import org.apache.lucene.search.ScoreMode;

/** Counts matching documents per asset type from the {@code type} doc values (M23.3.1). */
final class TypeCounts implements Collector {

    private final Map<AssetType, Long> counts = new EnumMap<>(AssetType.class);

    @Override
    public LeafCollector getLeafCollector(LeafReaderContext context) throws IOException {
        SortedSetDocValues values = DocValues.getSortedSet(context.reader(), SearchFields.TYPE);
        long[] perOrd = new long[(int) values.getValueCount()];
        return new LeafCollector() {
            @Override
            public void setScorer(Scorable scorer) {}

            @Override
            public void collect(int doc) throws IOException {
                if (values.advanceExact(doc)) {
                    for (int i = 0; i < values.docValueCount(); i++) {
                        perOrd[(int) values.nextOrd()]++;
                    }
                }
            }

            @Override
            public void finish() throws IOException {
                for (int ord = 0; ord < perOrd.length; ord++) {
                    if (perOrd[ord] == 0) {
                        continue;
                    }
                    AssetType type = typeOf(values.lookupOrd(ord).utf8ToString());
                    if (type != null) {
                        counts.merge(type, perOrd[ord], Long::sum);
                    }
                }
            }
        };
    }

    @Override
    public ScoreMode scoreMode() {
        return ScoreMode.COMPLETE_NO_SCORES;
    }

    private static AssetType typeOf(String name) {
        try {
            return AssetType.valueOf(name);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static final class Manager implements CollectorManager<TypeCounts, Map<AssetType, Long>> {

        @Override
        public TypeCounts newCollector() {
            return new TypeCounts();
        }

        @Override
        public Map<AssetType, Long> reduce(Collection<TypeCounts> collectors) {
            Map<AssetType, Long> total = new EnumMap<>(AssetType.class);
            collectors.forEach(collector -> collector.counts.forEach((type, n) -> total.merge(type, n, Long::sum)));
            return total;
        }
    }
}
