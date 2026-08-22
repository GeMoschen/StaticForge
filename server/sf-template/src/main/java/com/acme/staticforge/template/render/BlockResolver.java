package com.acme.staticforge.template.render;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

/**
 * A renderer hook for block instructions {@code $CMS_BODY}, {@code $CMS_INCLUDE} and
 * {@code $CMS_NAV} (spec §16.5, §19.1). The {@link OctlRenderer} has no knowledge of how
 * sections and structures are materialized — the generation/preview pipeline owns that
 * (spec §21.3). When a {@link RenderContext} carries no resolver, these instructions render
 * as empty strings (the historical default). When present, the resolver is invoked and its
 * result emitted verbatim (the resolver is responsible for any escaping).
 *
 * <p>Not a {@link FunctionalInterface}: it groups three related callbacks, one per block
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
     * Renders a navigation from {@code $CMS_NAV(uid[, args])}. Deferred to a later milestone;
     * the default implementation returns an empty string.
     *
     * @param structureUid the structure UID (or UUID string)
     * @param args named arguments supplied on the nav instruction
     * @return the rendered navigation, or {@code null}/{@code ""}
     */
    String renderNav(String structureUid, Map<String, String> args);

    /**
     * Renders the nested children of a navigation node from {@code $CMS_NAV_RECURSE(node)}.
     * The supplied node is the resolved loop item (a JSON object carrying {@code children}
     * and {@code level}). The default implementation returns an empty string, preserving the
     * historical behavior for existing resolvers; the generation navigation renderer overrides
     * it to re-enter the same structure channel template at {@code level + 1}.
     *
     * @param node the resolved {@code $CMS_NAV_RECURSE} loop item
     * @return the rendered child navigation, or {@code null}/{@code ""} when not applicable
     */
    default String renderNavRecurse(JsonNode node) {
        return "";
    }
}
