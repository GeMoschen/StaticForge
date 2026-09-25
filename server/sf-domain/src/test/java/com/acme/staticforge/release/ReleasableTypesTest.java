package com.acme.staticforge.release;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** Which assets carry release pointers (M27.1.1, epic decision 1). */
class ReleasableTypesTest {

    @ParameterizedTest
    @EnumSource(value = AssetType.class, names = {"PAGE", "RECORD", "RECORD_SET", "GLOBAL_SET", "MEDIA", "PAGE_REFERENCE"})
    @DisplayName("editorial content is releasable")
    void contentIsReleasable(AssetType type) {
        assertThat(ReleasableTypes.isReleasable(type, null, "x")).isTrue();
    }

    @ParameterizedTest
    @EnumSource(value = AssetType.class, names = {"PAGE_TEMPLATE", "SECTION_TEMPLATE", "DATASET"})
    @DisplayName("templates and dataset schemas stay live")
    void templatesStayLive(AssetType type) {
        assertThat(ReleasableTypes.isReleasable(type, null, "x")).isFalse();
    }

    @ParameterizedTest
    @EnumSource(value = FolderScope.class, names = {"PAGES", "MEDIA", "NAVIGATION", "GLOBALS", "CONTENT"})
    @DisplayName("folders of the editorial stores are releasable")
    void editorialFolders(FolderScope scope) {
        assertThat(ReleasableTypes.isReleasable(AssetType.FOLDER, folder(scope), "products")).isTrue();
    }

    @Test
    @DisplayName("template folders, store roots and the hidden root are not")
    void otherFolders() {
        assertThat(ReleasableTypes.isReleasable(AssetType.FOLDER, folder(FolderScope.TEMPLATES), "page_templates")).isFalse();
        assertThat(ReleasableTypes.isReleasable(AssetType.FOLDER, folder(FolderScope.PAGES), FolderScope.PAGES_ROOT_UID)).isFalse();
        assertThat(ReleasableTypes.isReleasable(AssetType.FOLDER, folder(FolderScope.CONTENT), FolderScope.CONTENT_ROOT_UID)).isFalse();
        assertThat(ReleasableTypes.isReleasable(AssetType.FOLDER, JsonNodeFactory.instance.objectNode(), "root")).isFalse();
    }

    private static JsonNode folder(FolderScope scope) {
        return JsonNodeFactory.instance.objectNode().put("scope", scope.name());
    }
}
