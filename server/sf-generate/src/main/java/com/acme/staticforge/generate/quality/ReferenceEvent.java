package com.acme.staticforge.generate.quality;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Objects;
import java.util.UUID;

/**
 * A reference the renderer could not resolve while rendering one output (M30, epic decision 8). Findings about it come
 * from these events, not from the HTML: the reference rendered {@code ""}, so the markup no longer says where it
 * pointed. Events are kept in the build's sidecar with the output's facts, so an output carried into a later build
 * still reports them.
 *
 * @param kind why it didn't resolve
 * @param targetKind the reference kind as written: {@code page}, {@code media}, {@code folder} or
 *     {@code section_template}
 * @param target the target's uuid
 * @param targetUid the target's uid when the snapshot still knows it; {@code null} for a {@link Kind#MISSING} target
 * @param locale the language the reference resolved in; {@code null} without locales
 * @param editorPath where the rendering page's content holds the reference ({@code content.cta},
 *     {@code bodies.main[0].content.image}, {@code bodies.main[1].templateRef}); {@code null} when the reference is
 *     written in a template ({@code $CMS_REF(page:about)$}) or in another asset's content
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ReferenceEvent(
        Kind kind, String targetKind, UUID target, String targetUid, String locale, String editorPath) {

    /** Why a reference didn't resolve. */
    public enum Kind {
        /** The target is soft-deleted at the build revision ({@code SF-GEN-0220}). */
        DELETED,
        /** The target exists but isn't released in the language ({@code SF-GEN-0221}, M27). */
        UNRELEASED,
        /** The target isn't in the snapshot at all (a hard-deleted or foreign uuid). */
        MISSING
    }

    @JsonCreator
    public ReferenceEvent {
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(targetKind, "targetKind");
    }

    /** An event as the renderer records it: it doesn't know the editor path. */
    public ReferenceEvent(Kind kind, String targetKind, UUID target, String targetUid, String locale) {
        this(kind, targetKind, target, targetUid, locale, null);
    }

    /** The same event, located at {@code path} of the rendering page's content. */
    public ReferenceEvent withEditorPath(String path) {
        return new ReferenceEvent(kind, targetKind, target, targetUid, locale, path);
    }
}
