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
 */
public record ImportConflict(
        ConflictSeverity severity, ConflictType type, String elementUuid, String elementLabel, String detail) {

    /**
     * Preferred construction path: derives {@code severity} from {@code type.severity()}
     * so call sites can't accidentally pass a mismatched severity.
     */
    public static ImportConflict of(ConflictType type, String elementUuid, String elementLabel, String detail) {
        return new ImportConflict(type.severity(), type, elementUuid, elementLabel, detail);
    }
}
