package com.acme.staticforge.api.dto;

import java.util.List;

/** One page of the Changes view (M27.1.3). */
public record ChangesPageView(List<ChangeRowView> rows, int page, int size, long totalElements, int totalPages) {}
