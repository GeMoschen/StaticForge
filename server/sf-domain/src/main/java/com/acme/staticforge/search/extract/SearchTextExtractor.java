package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import java.util.Optional;

/**
 * Turns one asset type's current version into a {@link SearchDocument} (M23.1.2). Extraction is pure: it reads the
 * asset and, through the context, cached definitions and blob text, and never writes.
 */
public interface SearchTextExtractor {

    boolean supports(AssetType type);

    /** The document to index, or empty when the asset is never searchable (e.g. a store's root folder). */
    Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context);
}
