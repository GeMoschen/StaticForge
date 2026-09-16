package com.acme.staticforge.asset.folder;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import org.junit.jupiter.api.Test;

/**
 * The leaf-type → store mapping (spec §10.2). {@code requiredFor} is what
 * {@code AssetServiceImpl.validateFolderScope} enforces, so a type missing from it would be
 * silently placeable in any store.
 */
class FolderScopeTest {

    @Test
    void everyLeafTypeIsMappedToItsOwnStore() {
        assertThat(FolderScope.requiredFor(AssetType.PAGE)).isEqualTo(FolderScope.PAGES);
        assertThat(FolderScope.requiredFor(AssetType.MEDIA)).isEqualTo(FolderScope.MEDIA);
        assertThat(FolderScope.requiredFor(AssetType.PAGE_REFERENCE)).isEqualTo(FolderScope.NAVIGATION);
        assertThat(FolderScope.requiredFor(AssetType.PAGE_TEMPLATE)).isEqualTo(FolderScope.TEMPLATES);
        assertThat(FolderScope.requiredFor(AssetType.SECTION_TEMPLATE)).isEqualTo(FolderScope.TEMPLATES);
        assertThat(FolderScope.requiredFor(AssetType.GLOBAL_SET)).isEqualTo(FolderScope.GLOBALS);
    }

    /** A folder belongs to a store, it is not scoped *into* one. */
    @Test
    void folderItselfIsNotScoped() {
        assertThat(FolderScope.requiredFor(AssetType.FOLDER)).isNull();
    }

    @Test
    void everyStoreHasADistinctFixedRootUid() {
        assertThat(FolderScope.GLOBALS_ROOT_UID).isEqualTo("globals_root");
        assertThat(java.util.Set.of(
                        FolderScope.PAGES_ROOT_UID,
                        FolderScope.MEDIA_ROOT_UID,
                        FolderScope.NAVIGATION_ROOT_UID,
                        FolderScope.TEMPLATES_ROOT_UID,
                        FolderScope.GLOBALS_ROOT_UID))
                .hasSize(5);
    }

    @Test
    void globalsRootReadsBackFromAFolderPayload() {
        JsonPayload payload = new JsonPayload("{\"scope\":\"GLOBALS\",\"protected\":true}");
        assertThat(FolderScope.fromPayload(payload.node())).isEqualTo(FolderScope.GLOBALS);
        assertThat(FolderScope.isProtected(payload.node())).isTrue();
    }

    private record JsonPayload(String text) {
        com.fasterxml.jackson.databind.JsonNode node() {
            try {
                return new com.fasterxml.jackson.databind.ObjectMapper().readTree(text);
            } catch (Exception e) {
                throw new AssertionError("bad test json", e);
            }
        }
    }
}
