package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Developer assets (M23.1.2): page and section templates index their CDL and every channel's OCTL source, dataset
 * schemas their CDL and per-channel record templates (M25.2.1), all as code (neutral analysis only, never stemmed).
 * A dataset's description is prose.
 */
@Component
public class TemplateTextExtractor implements SearchTextExtractor {

    @Override
    public boolean supports(AssetType type) {
        return type == AssetType.PAGE_TEMPLATE || type == AssetType.SECTION_TEMPLATE || type == AssetType.DATASET;
    }

    @Override
    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        JsonNode payload = asset.payload();
        TextBuilder source = new TextBuilder(context.maxTextChars()).add(Documents.text(payload, "contentDefinition"));
        JsonNode channels = payload == null ? null : payload.get("channelTemplates");
        if (channels != null && channels.isObject()) {
            List<Map.Entry<String, JsonNode>> sorted = new ArrayList<>();
            channels.fields().forEachRemaining(sorted::add);
            sorted.sort(Map.Entry.comparingByKey());
            sorted.forEach(channel -> source.add(Documents.text(channel.getValue(), "source")));
        }
        String text = asset.type() == AssetType.DATASET
                ? new TextBuilder(context.maxTextChars()).add(Documents.text(payload, "description")).build()
                : "";
        return Optional.of(Documents.of(asset, text, source.build()));
    }
}
