package com.acme.staticforge.api.dto;

import java.util.List;

/** The paging envelope of a record listing (spec §20.1): {@code {content: [...], page: {...}}}. */
public record RecordPageView(List<RecordRowView> content, PageMeta page) {

    /** {@code number} is zero-based. */
    public record PageMeta(int size, int number, long totalElements, int totalPages) {}
}
