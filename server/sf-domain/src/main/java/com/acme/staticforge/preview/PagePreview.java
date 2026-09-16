package com.acme.staticforge.preview;

/**
 * A rendered page preview (spec §19) and which page of it was rendered (M21.3.1): {@code pageNumber} of
 * {@code totalPages}, both {@code 1} for a page that isn't paginated.
 */
public record PagePreview(String html, int pageNumber, int totalPages) {}
