package com.acme.staticforge.api.dto;

import java.util.List;

/** A job's run history: {@code {content: [...], page: {...}}} like every paged listing (spec §20.1). */
public record AdminJobRunPage(List<AdminJobRunView> content, RecordPageView.PageMeta page) {}
