package com.acme.staticforge.search.extract;

import com.acme.staticforge.template.content.ContentDefinition;
import java.util.Optional;
import java.util.UUID;

/**
 * What extraction may read besides the asset itself (M23.1.2): compiled definitions through the version-keyed compile
 * cache, and blob text. Implementations memoize per indexing pass, so thousands of pages on one template compile its
 * CDL once.
 */
public interface ExtractionContext {

    /** The effective (own and inherited) definition of a live page template. */
    Optional<ContentDefinition> pageTemplateDefinition(UUID pageTemplate);

    /** The definition of a live section template. */
    Optional<ContentDefinition> sectionTemplateDefinition(UUID sectionTemplate);

    /** The definition of a live dataset schema. */
    Optional<ContentDefinition> datasetDefinition(UUID dataset);

    /** The definition compiled from {@code cdlSource}, owned by the asset version {@code (owner, revision)}. */
    ContentDefinition definition(UUID owner, long revision, String cdlSource);

    /** A stored blob decoded as UTF-8 (malformed bytes replaced), at most {@link #maxTextChars()}; empty if missing. */
    Optional<String> blobText(String sha256);

    /** The per-document text budget ({@code sf.search.max-text-chars}). */
    int maxTextChars();
}
