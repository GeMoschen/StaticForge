package com.acme.staticforge.api.dto;

import java.util.List;

/** Client-facing conflict report returned by the analyze-import endpoint (M10.2.3). */
public record ConflictReportView(List<ImportConflictView> conflicts, boolean hasBlocking) {}
