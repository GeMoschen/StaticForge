package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * The release state of an exported asset in one locale key (M27.5.1, protocol {@code 8}): an open release pointer —
 * the locale key it is released under and the version it renders there — or the fact that the asset was released
 * there once and is not any more.
 *
 * <p>{@link State#DRAFT_EQUALS}: the pointer is at the exported (current) version, so nothing else is carried. {@link
 * State#PAYLOAD}: the released version is an older one; its payload and structural fields are carried so an archive
 * reproduces "published v1, draft v2". The parent folder and template are source UUIDs, like {@link ExportedAsset}'s.
 * {@link State#UNPUBLISHED}: no open pointer, but there was one — what tells {@code UNPUBLISHED} from {@code NEW}.
 *
 * @param locale the locale key: {@code ""} for "every locale" (a project without locales, media that isn't
 *     localized), else a locale code
 * @param uid the uid the asset is released under, only when it differs from the asset's own (a uid change writes no
 *     version)
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ExportedRelease(
        String locale,
        State state,
        String uid,
        JsonNode payload,
        String displayName,
        String parentFolderUuid,
        String folderPath,
        String templateUuid,
        String mimeType,
        Long sizeBytes) {

    /** How the released version relates to the exported one. */
    public enum State {
        /** The released version is the exported version. */
        DRAFT_EQUALS,
        /** The released version differs; its content is carried in the entry. */
        PAYLOAD,
        /** Released once, not any more: nothing renders in this locale key. */
        UNPUBLISHED
    }

    /** A pointer at the exported version itself. */
    public static ExportedRelease draftEquals(String locale, String uid) {
        return new ExportedRelease(locale, State.DRAFT_EQUALS, uid, null, null, null, null, null, null, null);
    }

    /** A locale key that was released once and is not any more. */
    public static ExportedRelease unpublished(String locale) {
        return new ExportedRelease(locale, State.UNPUBLISHED, null, null, null, null, null, null, null, null);
    }
}
