package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Assets holding CDL-declared values outside pages (M23.1.2): a global property set (M17) walks its {@code content}
 * with its own definition, a dataset record (M19) with its dataset's definition. Without a definition every string
 * leaf is indexed.
 */
@Component
public class ContentHolderTextExtractor implements SearchTextExtractor {

    @Override
    public boolean supports(AssetType type) {
        return type == AssetType.GLOBAL_SET || type == AssetType.RECORD;
    }

    @Override
    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        JsonNode payload = asset.payload();
        Optional<ContentDefinition> definition = asset.type() == AssetType.GLOBAL_SET
                ? Optional.of(context.definition(asset.uuid(), asset.revision(), Documents.text(payload, "contentDefinition")))
                : ContentTextWalker.uuid(payload == null ? null : payload.get("datasetRef")).flatMap(context::datasetDefinition);
        TextBuilder text = new TextBuilder(context.maxTextChars());
        JsonNode content = payload == null ? null : payload.get("content");
        if (definition.isPresent()) {
            ContentTextWalker.walk(content, definition.get(), context, text);
        } else {
            ContentTextWalker.leaves(content, text);
        }
        return Optional.of(Documents.of(asset, text.build(), ""));
    }
}
