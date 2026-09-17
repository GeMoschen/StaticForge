package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** Navigation page references (M23.1.2): the navigation label; the display name is in the title. */
@Component
public class PageReferenceTextExtractor implements SearchTextExtractor {

    @Override
    public boolean supports(AssetType type) {
        return type == AssetType.PAGE_REFERENCE;
    }

    @Override
    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        String label = new TextBuilder(context.maxTextChars()).add(Documents.text(asset.payload(), "label")).build();
        return Optional.of(Documents.of(asset, label, ""));
    }
}
