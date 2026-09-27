package com.acme.staticforge.api.dto;

import java.util.UUID;

/**
 * Create or replace a manual redirect (M30.4.1). {@code fromPath} is an output path of the site
 * ({@code products/hammer.html}; a leading {@code /} is dropped, a directory path such as {@code old/} means its index
 * file). Exactly one target: {@code toAssetUuid} (a page; {@code toPageNumber} defaults to 1) or {@code toPath} (an
 * output path, optionally with query and fragment, or an absolute {@code http(s)} URL). {@code locale} is required in
 * a project with languages and must be empty otherwise.
 */
public record RedirectRequest(
        String channel, String locale, String fromPath, UUID toAssetUuid, Integer toPageNumber, String toPath) {}
