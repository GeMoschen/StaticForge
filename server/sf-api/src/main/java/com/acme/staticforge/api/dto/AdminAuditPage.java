package com.acme.staticforge.api.dto;

import java.util.List;

/** The instance audit listing: {@code {content: [...], page: {...}}} like every paged listing (spec §20.1). */
public record AdminAuditPage(List<AdminAuditEntry> content, RecordPageView.PageMeta page) {}
