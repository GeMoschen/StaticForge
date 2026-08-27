package com.acme.staticforge.exportimport;

/**
 * A single problem found while analyzing an import archive against a target project.
 *
 * @param severity derived from {@code type}'s fixed {@link ConflictType#severity()}
 * @param type the kind of conflict
 * @param elementUuid the archive asset UUID this conflict concerns, or {@code null} for
 *     settings-key conflicts (which have no asset UUID)
 * @param elementLabel a human-readable label for the affected element (display name, UID,
 *     or settings key)
 * @param detail free-text explanation for the UI
 * @param explicit the matching {@link ExportedAsset#isExplicit()} for this conflict's
 *     element (feature `selection-provenance`, `M11.2.1`/`M11.2.2`), or {@code true} for a
 *     settings-key conflict (which has no backing {@code ExportedAsset} and is never subject
 *     to {@code skipExistingImplicit} filtering)
 */
public record ImportConflict(
        ConflictSeverity severity, ConflictType type, String elementUuid, String elementLabel, String detail,
        boolean explicit) {

    /**
     * Preferred construction path: derives {@code severity} from {@code type.severity()}
     * so call sites can't accidentally pass a mismatched severity.
     */
    public static ImportConflict of(
            ConflictType type, String elementUuid, String elementLabel, String detail, boolean explicit) {
        return new ImportConflict(type.severity(), type, elementUuid, elementLabel, detail, explicit);
    }

    /** Convenience for conflict kinds with no backing {@code ExportedAsset} (always explicit). */
    public static ImportConflict of(ConflictType type, String elementUuid, String elementLabel, String detail) {
        return of(type, elementUuid, elementLabel, detail, true);
    }
}
