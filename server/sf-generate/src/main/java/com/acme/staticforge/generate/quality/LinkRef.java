package com.acme.staticforge.generate.quality;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One outgoing reference of an HTML output (M30.1.1): an {@code href}, {@code src}, {@code poster} or one
 * {@code srcset} candidate, as written and as {@link LinkResolver} resolved it against the build.
 *
 * @param element the element's tag name, lower case ({@code a}, {@code img}, {@code link}, …)
 * @param attribute the attribute it came from ({@code href}, {@code src}, {@code srcset}, {@code poster})
 * @param raw the URL as written (one candidate for {@code srcset})
 * @param resolvedPath the site path it resolves to (no leading slash, percent-decoded, pretty URLs mapped to the index
 *     file); {@code null} when it is skipped — external, another scheme, empty, or escaping the site root
 * @param fragment the decoded {@code #fragment}; {@code ""} for a bare {@code #}, {@code null} when there is none
 * @param selector a stable CSS selector of the element ({@link Selectors})
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LinkRef(
        String element, String attribute, String raw, String resolvedPath, String fragment, String selector) {

    /** Whether the reference resolves to a path of this site. */
    public boolean internal() {
        return resolvedPath != null;
    }
}
