package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.query.RecordSetQueryDiagnostic;
import java.util.List;

/**
 * A draft record set query checked without saving it (M25.1.2; {@code POST /record-sets/{uuid}/preview-query}
 * in M25.3.1), for a query editor's live feedback.
 *
 * @param valid whether the draft would save
 * @param diagnostics every finding, each naming its query part ({@code where}, {@code sort}, …) and position
 * @param matchCount how many of the set's live records the draft's {@code where} matches, before
 *     {@code offset}/{@code limit}; {@code 0} for an invalid draft
 * @param selectedCount how many records the set would show with the draft ({@code offset}/{@code limit}
 *     applied); {@code 0} for an invalid draft
 */
public record RecordSetQueryPreview(
        boolean valid, List<RecordSetQueryDiagnostic> diagnostics, long matchCount, long selectedCount) {

    public RecordSetQueryPreview {
        diagnostics = List.copyOf(diagnostics);
    }
}
