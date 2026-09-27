package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Every {@link SearchTextExtractor}, in {@code @Order} (M23.1.2). The first extractor supporting a type extracts it.
 * A type no extractor supports is logged once and yields no document; it never fails an indexing pass.
 */
@Component
public class SearchTextExtractorRegistry {

    private static final Logger log = LoggerFactory.getLogger(SearchTextExtractorRegistry.class);

    private final List<SearchTextExtractor> extractors;
    private final Set<AssetType> reportedUnsupported = EnumSet.noneOf(AssetType.class);

    /** @param extractors ordered by Spring ({@code @Order}/{@code Ordered}) */
    public SearchTextExtractorRegistry(List<SearchTextExtractor> extractors) {
        this.extractors = List.copyOf(extractors);
    }

    /** Whether {@link #extract} yields a document for {@code asset}; see {@link SearchTextExtractor#indexes}. */
    public boolean indexes(IndexableAsset asset) {
        for (SearchTextExtractor extractor : extractors) {
            if (extractor.supports(asset.type())) {
                return extractor.indexes(asset);
            }
        }
        return false;
    }

    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        for (SearchTextExtractor extractor : extractors) {
            if (extractor.supports(asset.type())) {
                return extractor.extract(asset, context);
            }
        }
        synchronized (reportedUnsupported) {
            if (reportedUnsupported.add(asset.type())) {
                log.warn("No search text extractor supports asset type {}; its assets are not searchable", asset.type());
            }
        }
        return Optional.empty();
    }
}
