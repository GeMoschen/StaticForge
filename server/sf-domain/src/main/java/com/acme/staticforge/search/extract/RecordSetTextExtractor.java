package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Record sets (M25): the display name is in the title, the name of the set's dataset is the text, so a
 * search for "team" finds every set of the "Team" dataset. The stored query is not prose and stays out.
 */
@Component
public class RecordSetTextExtractor implements SearchTextExtractor {

    @Override
    public boolean supports(AssetType type) {
        return type == AssetType.RECORD_SET;
    }

    @Override
    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        TextBuilder text = new TextBuilder(context.maxTextChars());
        if (asset.templateUuid() != null) {
            context.datasetName(asset.templateUuid()).ifPresent(text::add);
        }
        return Optional.of(Documents.of(asset, text.build(), ""));
    }
}
