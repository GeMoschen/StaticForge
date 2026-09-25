package com.acme.staticforge.api.dto;

import java.util.List;

/** One page of schedules (M27.4.4). */
public record SchedulePageView(List<ScheduleView> rows, int page, int size, long totalElements, int totalPages) {}
