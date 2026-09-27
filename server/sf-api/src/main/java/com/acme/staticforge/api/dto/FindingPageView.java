package com.acme.staticforge.api.dto;

import java.util.List;

/** A page of a run's findings (M30.1.2), sorted by output path, then code. */
public record FindingPageView(List<FindingView> content, RecordPageView.PageMeta page) {}
