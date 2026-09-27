package com.acme.staticforge.generate.quality;

import java.util.Objects;
import java.util.UUID;

/**
 * A reference the renderer could not resolve while rendering one output (M30, epic decision 8). Findings about it come
 * from these events, not from the HTML: the reference rendered {@code ""}, so the markup no longer says where it
 * pointed.
 *
 * @param kind why it didn't resolve
 * @param targetKind the reference kind as written: {@code page}, {@code media}, {@code folder} or
 *     {@code section_template}
 * @param target the target's uuid
 * @param targetUid the target's uid when the snapshot still knows it; {@code null} for a {@link Kind#MISSING} target
 * @param locale the language the reference resolved in; {@code null} without locales
 */
public record ReferenceEvent(Kind kind, String targetKind, UUID target, String targetUid, String locale) {

    /** Why a reference didn't resolve. */
    public enum Kind {
        /** The target is soft-deleted at the build revision ({@code SF-GEN-0220}). */
        DELETED,
        /** The target exists but isn't released in the language ({@code SF-GEN-0221}, M27). */
        UNRELEASED,
        /** The target isn't in the snapshot at all (a hard-deleted or foreign uuid). */
        MISSING
    }

    public ReferenceEvent {
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(targetKind, "targetKind");
    }
}
