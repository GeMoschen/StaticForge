package com.acme.staticforge.template.render;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.UUID;

/**
 * A renderer hook for block instructions {@code $CMS_BODY} and {@code $CMS_INCLUDE}
 * (spec §16.5, §19.1). The {@link OctlRenderer} has no knowledge of how sections are
 * materialized — the generation/preview pipeline owns that (spec §21.3). When a
 * {@link RenderContext} carries no resolver, these instructions render as empty strings
 * (the historical default). When present, the resolver is invoked and its result emitted
 * verbatim (the resolver is responsible for any escaping).
 *
 * <p>Not a {@link FunctionalInterface}: it groups related callbacks, one per block
 * instruction, so callers implement them together.
 */
public interface BlockResolver {

    /**
     * Renders a declared page body by walking its section instances (§10.3).
     *
     * @param bodyName the body name from {@code $CMS_BODY(name)}
     * @return the rendered body, or {@code null}/{@code ""} for an unknown body
     */
    String renderBody(String bodyName);

    /**
     * Renders a section template instance referenced by {@code $CMS_INCLUDE(uid[, args])}.
     *
     * @param uid the section-template UID (or UUID string when no UID is resolvable)
     * @param args named arguments supplied on the include instruction
     * @return the rendered section, or {@code null}/{@code ""} when unresolvable
     */
    String renderInclude(String uid, Map<String, String> args);

    /**
     * Renders a CATALOG editor's cards — when a {@code $CMS_VALUE(accessor)$} resolves to a
     * CATALOG-typed value ({@code {type:"CATALOG", cards:[…]}}) — one per element of the
     * resolved {@code cards} array, each rendered exactly like a body's section instance
     * (spec-analogous to {@link #renderBody}), so a card's own template may itself declare
     * another CATALOG editor and recurse. The default implementation returns an empty string.
     *
     * @param cards the resolved {@code cards} array (each {@code {instanceId, templateRef, content}})
     * @return the rendered cards, or {@code null}/{@code ""} when not applicable
     */
    default String renderCatalog(JsonNode cards) {
        return "";
    }

    /**
     * Renders a navigation folder's resolved tree for {@code $CMS_NAVIGATION(nav:uid [, depth=N]
     * [, channel=key])$} (spec §17, `M8.1.4`). Unlike {@link #renderBody}/{@link #renderInclude},
     * there is no per-channel template stored on a navigation folder (`M8.1.2` deliberately kept
     * navigation folders as plain folders with no template-storage concept) — the implementation
     * is expected to resolve {@code navFolderUuid}'s tree (via {@code NavigationService.tree})
     * and produce the complete nested-list markup itself, one call per node via
     * {@link #renderNavigationRecurse}, marking {@code active}/{@code trail} relative to the page
     * being rendered and resolving each entry's href via the existing {@code UrlResolver}/
     * output-path machinery (spec §17.2 step 5).
     *
     * @param navFolderUuid the resolved {@code nav:} folder UUID
     * @param args named arguments from the instruction ({@code depth}, {@code channel}, …)
     * @return the rendered navigation markup, or {@code null}/{@code ""} when unresolvable
     */
    default String renderNavigation(UUID navFolderUuid, Map<String, String> args) {
        return "";
    }

    /**
     * Renders one navigation node's children as a nested list — the recursion hook mirroring the
     * old {@code $CMS_NAV_RECURSE$} ergonomics against the new tree shape (`M8.1.3`'s
     * {@code NavTreeNode}), exposed here as {@link JsonNode} rather than the {@code sf-domain}
     * type directly so {@code sf-template} stays free of a {@code sf-domain} dependency (mirrors
     * {@link #renderCatalog}). {@code node} carries the same shape {@link #renderNavigation}'s
     * implementation builds internally: {@code assetUuid, type, uid, displayName, label, href,
     * active, trail, children[]}.
     *
     * @param node the current navigation node (its {@code children} array is what gets rendered)
     * @return the rendered nested-list markup for {@code node}'s children, or {@code null}/{@code
     *     ""} when {@code node} has none
     */
    default String renderNavigationRecurse(JsonNode node) {
        return "";
    }
}
