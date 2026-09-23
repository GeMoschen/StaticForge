package com.acme.staticforge.template.render;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Looks up another asset's values for a cross-asset accessor such as
 * {@code $CMS_VALUE(page:about.headline)$} (spec §16.2, §16.4). The {@link OctlRenderer} has no
 * knowledge of where assets live — generation implements this over its snapshot, preview over
 * the version valid at the preview revision — mirroring the {@link UrlResolver} /
 * {@link BlockResolver} split. When a {@link RenderContext} carries no resolver, cross-asset
 * values render empty (the historical default); the dependency on the target is recorded
 * either way.
 *
 * <p>The implementation returns the target's <em>root value object</em>; the renderer walks the
 * accessor's path over it exactly like a local value, so dotted paths, loops, conditions and
 * filters behave identically. The root value object per asset type (the string is the
 * accessor's prefix, not a domain enum, so {@code sf-template} stays free of {@code sf-domain}):
 *
 * <ul>
 *   <li>{@code page} — the page's editor values ({@code payload.content}); bodies, navigation,
 *       output and meta payload sections are not exposed.
 *   <li>{@code media} — a flat object: {@code altText, caption, copyright, fileName, mimeType,
 *       width, height, …}.
 *   <li>{@code page_reference} — {@code {label, …}}.
 *   <li>{@code record} — the record's item: its values plus {@code _uuid}, {@code _uid},
 *       {@code _displayName}, {@code _folderPath}, {@code _recordSet} (M25), {@code _changedAt} (M19.3.2), the same object a
 *       dataset loop binds.
 *   <li>template and folder types — no values: an object holding only the reserved {@code _meta}
 *       sub-object below.
 * </ul>
 *
 * <p>Every root value object additionally carries a reserved {@code _meta} sub-object with
 * {@code uid} and {@code displayName} (for example
 * {@code $CMS_VALUE(page:about._meta.displayName)$}).
 *
 * <p>{@code MissingNode} is reserved for a target that does not exist (or is soft-deleted) in
 * the data the implementation reads; the renderer then renders empty and emits an
 * {@code SF-TPL-0112} warning.
 *
 * <p>A value object is raw stored JSON, never rendered output, so resolving one cannot itself
 * trigger a render.
 */
@FunctionalInterface
public interface AssetValueResolver {

    /**
     * @param assetType the accessor's asset-type prefix (for example {@code "page"})
     * @param uuid the target UUID resolved at compile time
     * @return the target's root value object, or {@code MissingNode} when the asset is missing or
     *     deleted
     */
    JsonNode valueOf(String assetType, UUID uuid);

    /**
     * The live records of a dataset (M19.3.2), in any order: the source of
     * {@code $CMS_FOR(x : dataset:uid, …)$}, which applies the loop's query to them. Generation
     * answers from an index built once per snapshot, preview from the records valid at the preview
     * revision. Without an implementation a dataset loop renders nothing.
     *
     * @param datasetUuid the dataset UUID resolved at compile time
     */
    default java.util.List<com.acme.staticforge.template.query.RecordView> datasetRecords(UUID datasetUuid) {
        return java.util.List.of();
    }
}
