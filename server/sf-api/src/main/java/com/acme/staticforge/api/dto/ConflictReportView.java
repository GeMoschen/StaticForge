package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * Client-facing conflict report returned by the analyze-import endpoint (M10.2.3). {@code hasBlocking}: any
 * {@code BLOCKING} conflict; {@code blocksImport} (M25): any conflict that refuses the whole import — when it
 * is {@code false}, committing imports everything except the assets the blocking conflicts reject.
 */
public record ConflictReportView(List<ImportConflictView> conflicts, boolean hasBlocking, boolean blocksImport) {}
