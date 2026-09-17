package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.media.TextMediaTypes;
import com.acme.staticforge.search.SearchDocument;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Media (M23.1.2): file name, alt text, caption and copyright as prose. A processed text file (M18) also has its
 * decoded content indexed as code, capped by {@code sf.search.max-text-chars}. Binary content is not read.
 */
@Component
public class MediaTextExtractor implements SearchTextExtractor {

    @Override
    public boolean supports(AssetType type) {
        return type == AssetType.MEDIA;
    }

    @Override
    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        JsonNode payload = asset.payload();
        String text = new TextBuilder(context.maxTextChars())
                .add(Documents.text(payload, "fileName"))
                .add(Documents.text(payload, "altText"))
                .add(Documents.text(payload, "caption"))
                .add(Documents.text(payload, "copyright"))
                .build();
        String source = "";
        String sha = Documents.text(payload, "blobSha256");
        if (TextMediaTypes.isProcessed(payload) && sha != null) {
            source = context.blobText(sha).orElse("");
        }
        return Optional.of(Documents.of(asset, text, source));
    }
}
