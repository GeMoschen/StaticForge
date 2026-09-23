package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.query.RecordSetQueryDiagnostic;
import java.util.List;

/**
 * A draft record set query checked without saving it (M25.3.1), for the query editor's live feedback.
 * {@code matchCount} is how many of the set's live records the draft's {@code where} matches before
 * {@code offset}/{@code limit}, {@code selectedCount} how many the set would show; both are {@code 0}
 * when the draft is not {@code valid}.
 */
public record RecordSetQueryPreviewView(
        boolean valid, List<RecordSetQueryDiagnostic> diagnostics, long matchCount, long selectedCount) {}
