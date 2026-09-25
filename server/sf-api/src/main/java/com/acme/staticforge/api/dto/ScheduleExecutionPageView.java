package com.acme.staticforge.api.dto;

import java.util.List;

/** One page of a schedule's executions, newest first (M27.4.4). */
public record ScheduleExecutionPageView(
        List<ScheduleExecutionView> rows, int page, int size, long totalElements, int totalPages) {}
