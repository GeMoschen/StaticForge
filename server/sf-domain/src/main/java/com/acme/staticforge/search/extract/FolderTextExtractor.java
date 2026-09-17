package com.acme.staticforge.search.extract;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.PathService;
import com.acme.staticforge.search.SearchDocument;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Folders (M23.1.2): the display name only, in the title. The hidden root and every fixed store root (and the fixed
 * template folders) are infrastructure, not something to find, and produce no document.
 */
@Component
public class FolderTextExtractor implements SearchTextExtractor {

    private static final Set<String> FIXED_FOLDERS = Set.of(
            PathService.ROOT_UID,
            FolderScope.PAGES_ROOT_UID,
            FolderScope.MEDIA_ROOT_UID,
            FolderScope.NAVIGATION_ROOT_UID,
            FolderScope.TEMPLATES_ROOT_UID,
            FolderScope.PAGE_TEMPLATES_UID,
            FolderScope.SECTION_TEMPLATES_UID,
            FolderScope.DATASETS_UID,
            FolderScope.GLOBALS_ROOT_UID,
            FolderScope.CONTENT_ROOT_UID);

    @Override
    public boolean supports(AssetType type) {
        return type == AssetType.FOLDER;
    }

    @Override
    public Optional<SearchDocument> extract(IndexableAsset asset, ExtractionContext context) {
        if (FIXED_FOLDERS.contains(asset.uid())
                || FolderScope.fromPayload(asset.payload()) == null
                || FolderScope.isProtected(asset.payload())) {
            return Optional.empty();
        }
        return Optional.of(Documents.of(asset, "", ""));
    }
}
