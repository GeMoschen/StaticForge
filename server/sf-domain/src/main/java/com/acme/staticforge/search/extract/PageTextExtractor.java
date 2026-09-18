package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Pages (M23.1.2): the page's own content walked with its template's effective definition, every body section's
 * content with its section template's definition, and the page's {@code meta} title and description.
 */
@Component
public class PageTextExtractor implements SearchTextExtractor {

    private static final Logger log = LoggerFactory.getLogger(PageTextExtractor.class);

    @Override
    public boolean supports(AssetType type) {
        return type == AssetType.PAGE;
    }

    @Override
    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        JsonNode payload = asset.payload();
        TextBuilder text = new TextBuilder(context.maxTextChars());
        JsonNode meta = payload == null ? null : payload.get("meta");
        text.add(Documents.text(meta, "title")).add(Documents.text(meta, "description"));

        JsonNode content = payload == null ? null : payload.get("content");
        Optional<ContentDefinition> definition =
                ContentTextWalker.uuid(payload == null ? null : payload.get("templateRef")).flatMap(context::pageTemplateDefinition);
        if (definition.isPresent()) {
            ContentTextWalker.walk(content, definition.get(), context, text);
        } else {
            log.debug("Template of page {} is unavailable; indexing every string of its content", asset.uuid());
            ContentTextWalker.leaves(content, text);
        }

        JsonNode bodies = payload == null ? null : payload.get("bodies");
        if (bodies != null && bodies.isObject()) {
            bodies.forEach(sections -> {
                if (sections.isArray()) {
                    sections.forEach(section -> section(section, context, text));
                }
            });
        }
        return Optional.of(Documents.of(asset, text, ""));
    }

    private static void section(JsonNode section, ExtractionContext context, TextBuilder text) {
        JsonNode content = section.get("content");
        Optional<ContentDefinition> definition =
                ContentTextWalker.uuid(section.get("templateRef")).flatMap(context::sectionTemplateDefinition);
        if (definition.isPresent()) {
            ContentTextWalker.walk(content, definition.get(), context, text);
        } else {
            ContentTextWalker.leaves(content, text);
        }
    }
}
