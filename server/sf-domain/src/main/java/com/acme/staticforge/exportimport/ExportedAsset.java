package com.acme.staticforge.exportimport;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * Serialized state of a single asset in the {@code assets.json} payload of an export
 * archive. Identity (uuid/type/uid) is paired with the current version's mutable state
 * (payload, denormalized media columns) and the structural edges (parent folder and
 * template) as source UUIDs, so the importer can remap them to fresh imported UUIDs. The
 * {@code folderPath} column is carried so import can topologically order folders.
 *
 * <p>{@code explicit} (feature `selection-provenance`, `M11.2.1`) records whether this
 * asset was one of the caller's direct picks (a UUID in {@code ExportSelection.assetUuids()}
 * itself, or pulled in via a picked folder's live subtree / a {@code fullStores} scope) as
 * opposed to only being included because it's an ancestor folder needed to keep the archive's
 * {@code parentFolderUuid} chain intact. It is a boxed {@link Boolean}, not a primitive,
 * specifically so that a pre-M11 archive's {@code assets.json} — which has no {@code
 * explicit} key at all — deserializes to {@code null} rather than silently defaulting to
 * {@code false} via Jackson's record binding; {@link #isExplicit()} is what every consumer
 * must call, since it treats a {@code null} (old archive, or the field genuinely absent) the
 * same as {@code true} (every pre-M11 asset was, in effect, explicit — there was no such
 * thing as an implicit-only ancestor-provenance distinction yet). Never call {@link
 * #explicit()} directly outside this record.
 *
 * <p>{@code release} (M27.5.1, protocol {@code 8}) lists the asset's release state per locale key — its open pointers
 * and the locale keys it was unpublished in; {@code null} in an archive of protocol {@code <= 7} and for an asset that
 * isn't releasable, empty for one that was never released. {@code draftDeleted} marks an
 * asset whose draft is deleted while a released version is still live ({@code DELETION_PENDING}): the exported
 * fields are the tombstone's, and every release entry carries its released version.
 */
public record ExportedAsset(
        String uuid,
        String type,
        String uid,
        String displayName,
        String parentFolderUuid,
        String folderPath,
        String templateUuid,
        JsonNode payload,
        String mimeType,
        Long sizeBytes,
        Boolean explicit,
        List<ExportedRelease> release,
        Boolean draftDeleted) {

    /** {@code true} unless this asset was recorded as a non-explicit (ancestor-only) pick. */
    public boolean isExplicit() {
        return explicit == null || explicit;
    }

    /** {@code true} when the exported draft is a tombstone whose released version is still live. */
    public boolean isDraftDeleted() {
        return draftDeleted != null && draftDeleted;
    }

    /** The release entries; empty when there are none (or the archive predates release state). */
    public List<ExportedRelease> releases() {
        return release == null ? List.of() : release;
    }
}
