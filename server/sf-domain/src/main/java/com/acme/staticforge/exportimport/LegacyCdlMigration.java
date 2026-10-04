package com.acme.staticforge.exportimport;

import com.acme.staticforge.template.cdl.CdlSources;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * Brings the CDL of an archive written before M34 up to the stored shape. Templates, datasets and global sets used to
 * keep their whole CDL as one text in {@code contentDefinition} ({@code content { … } bodies { … } rules { … }}); since
 * M34 they keep {@code contentCdl}, {@code bodiesCdl} and {@code rulesCdl}, each the text inside its section's braces.
 *
 * <p>M34 did not raise the archive protocol, so an old payload is told apart by its fields: it has
 * {@code contentDefinition} and none of the section fields. Such a payload is split with {@link CdlSources#split}
 * and loses the old field; every other payload is returned as it is. The migration is silent (decided 2026-10-04) and
 * covers an asset's current payload and the payload of every release entry.
 */
final class LegacyCdlMigration {

    private static final String LEGACY_FIELD = "contentDefinition";

    private LegacyCdlMigration() {}

    /** The asset with its payload and its release payloads migrated; the same instance when nothing changed. */
    static ExportedAsset migrate(ExportedAsset asset) {
        JsonNode payload = migrate(asset.payload());
        List<ExportedRelease> releases = asset.release();
        boolean releasesChanged = false;
        if (releases != null) {
            List<ExportedRelease> migrated = releases.stream().map(LegacyCdlMigration::migrate).toList();
            releasesChanged = !migrated.equals(releases);
            releases = migrated;
        }
        if (payload == asset.payload() && !releasesChanged) {
            return asset;
        }
        return new ExportedAsset(
                asset.uuid(), asset.type(), asset.uid(), asset.displayName(), asset.parentFolderUuid(),
                asset.folderPath(), asset.templateUuid(), payload, asset.mimeType(), asset.sizeBytes(),
                asset.explicit(), releases, asset.draftDeleted());
    }

    private static ExportedRelease migrate(ExportedRelease release) {
        JsonNode payload = migrate(release.payload());
        if (payload == release.payload()) {
            return release;
        }
        return new ExportedRelease(
                release.locale(), release.state(), release.uid(), payload, release.displayName(),
                release.parentFolderUuid(), release.folderPath(), release.templateUuid(), release.mimeType(),
                release.sizeBytes());
    }

    /** The payload with its sections split out of {@code contentDefinition}; the argument itself when it is not an old one. */
    static JsonNode migrate(JsonNode payload) {
        if (payload == null || !payload.isObject() || !payload.has(LEGACY_FIELD) || CdlSources.presentIn(payload)) {
            return payload;
        }
        ObjectNode migrated = ((ObjectNode) payload).deepCopy();
        migrated.remove(LEGACY_FIELD);
        CdlSources.split(payload.path(LEGACY_FIELD).asText("")).writeTo(migrated);
        return migrated;
    }
}
