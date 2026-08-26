package com.acme.staticforge.api.dto;

/**
 * Reset-scope body for {@code POST .../url-registry/reset} (`M8.2.4`). Exactly one of
 * {@code entryId}/{@code channelKey}/{@code area} may be set; an empty body ({@code {}}, or the
 * request omitted entirely) resets the whole project. This shape exists because {@code
 * ResetScope} itself (a 4-arg discriminated record) isn't a natural JSON body — the controller
 * maps this DTO onto the right {@code ResetScope} factory method.
 */
public record UrlRegistryResetRequest(Long entryId, String channelKey, String area) {}
