package com.acme.staticforge.api.dto;

/**
 * Client-facing single import conflict (spec §26.5, feature {@code import-conflicts},
 * M10.2.3). {@code explicit} (feature {@code selection-provenance}, M11.2.1/M11.2.2) mirrors
 * {@code ImportConflict.explicit()} — whether the archive asset behind this conflict was one
 * of the caller's direct picks, as opposed to only an ancestor folder pulled in for path
 * integrity. {@code blocksImport} (M25) tells a {@code BLOCKING} conflict that refuses the whole import
 * from one that only rejects its own asset ({@code RECORD_OUTSIDE_RECORD_SET}: the record is not
 * imported, the rest of the archive is).
 */
public record ImportConflictView(
        String severity, String type, String elementUuid, String elementLabel, String detail, boolean explicit,
        boolean blocksImport) {}
