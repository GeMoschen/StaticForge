package com.acme.staticforge.api.dto;

import java.util.List;

/** The user listing: {@code {content: [...], page: {...}}} like every paged listing (spec §20.1). */
public record AdminUserPage(List<AdminUserRow> content, RecordPageView.PageMeta page) {}
