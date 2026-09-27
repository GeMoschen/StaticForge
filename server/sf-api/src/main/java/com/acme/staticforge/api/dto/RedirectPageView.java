package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * One page of the redirect registry (M30.4.1), sorted by channel, locale and source path. {@code basisRunId} is the
 * build of the default target the rows' states were computed against; {@code null} when nothing is published there.
 */
public record RedirectPageView(
        List<RedirectView> rows, int page, int size, long totalElements, int totalPages, Long basisRunId) {}
