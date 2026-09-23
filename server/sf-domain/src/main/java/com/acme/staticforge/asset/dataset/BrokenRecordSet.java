package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.query.RecordSetQueryDiagnostic;
import java.util.List;
import java.util.UUID;

/**
 * A record set whose stored query does not validate against its dataset's schema (M25.1.2): reported as a
 * warning by the dataset save that caused it (a removed or retyped field). The save itself succeeds; the set
 * renders no records until it is saved with a valid query.
 */
public record BrokenRecordSet(UUID uuid, String uid, String displayName, List<RecordSetQueryDiagnostic> diagnostics) {

    public BrokenRecordSet {
        diagnostics = List.copyOf(diagnostics);
    }
}
