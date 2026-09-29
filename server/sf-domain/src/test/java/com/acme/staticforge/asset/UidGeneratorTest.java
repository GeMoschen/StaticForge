package com.acme.staticforge.asset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.folder.FolderScope;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@link UidGenerator#deriveUid} against the §6.3 worked examples. */
class UidGeneratorTest {

    private static final Asset SAMPLE = new Asset(UUID.randomUUID(), 1L, AssetType.PAGE, "x", Instant.now(), 1L);

    @Test
    void slugifiesDiacriticsAndSpaces() {
        UidGenerator generator = new UidGenerator(emptyRepository());
        assertThat(generator.deriveUid("Über uns", 1L, AssetType.PAGE)).isEqualTo("uber_uns");
    }

    @Test
    void suffixesOnClashWithinSameType() {
        AssetRepository repo = mock(AssetRepository.class);
        when(repo.findByProjectIdAndAssetTypeAndUid(eq(1L), eq(AssetType.PAGE), eq("uber_uns"))).thenReturn(Optional.of(SAMPLE));
        when(repo.findByProjectIdAndAssetTypeAndUid(eq(1L), eq(AssetType.PAGE), eq("uber_uns_1"))).thenReturn(Optional.empty());
        UidGenerator generator = new UidGenerator(repo);
        assertThat(generator.deriveUid("Über uns", 1L, AssetType.PAGE)).isEqualTo("uber_uns_1");
    }

    @Test
    void fallsBackToAssetTypeForSymbols() {
        UidGenerator generator = new UidGenerator(emptyRepository());
        assertThat(generator.deriveUid("!!!", 1L, AssetType.PAGE)).isEqualTo("page");
    }

    /**
     * The fixed store roots are reserved (M17.1.1 adds {@code globals_root}), so a user-created
     * folder called "Globals Root" can never occupy the uid the Globals store's own root needs.
     */
    @Test
    void fixedStoreRootUidsAreReservedAgainstUserDerivedNames() {
        UidGenerator generator = new UidGenerator(emptyRepository());
        assertThat(generator.deriveUid("Globals Root", 1L, AssetType.FOLDER))
                .isNotEqualTo(FolderScope.GLOBALS_ROOT_UID)
                .isEqualTo(FolderScope.GLOBALS_ROOT_UID + "_1");
        assertThat(generator.deriveUid("Navigation Root", 1L, AssetType.FOLDER))
                .isEqualTo(FolderScope.NAVIGATION_ROOT_UID + "_1");
    }

    /** {@code index} is the channel's default {@code indexUid}, so a page must be able to take it. */
    @Test
    void indexIsNotReserved() {
        UidGenerator generator = new UidGenerator(emptyRepository());
        assertThat(generator.deriveUid("Index", 1L, AssetType.PAGE)).isEqualTo("index");
        assertThat(generator.isReserved("index")).isFalse();
        assertThat(generator.deriveUid("New", 1L, AssetType.PAGE)).isEqualTo("new_1");
    }

    private static AssetRepository emptyRepository() {
        AssetRepository repo = mock(AssetRepository.class);
        when(repo.findByProjectIdAndAssetTypeAndUid(anyLong(), any(AssetType.class), anyString()))
                .thenReturn(Optional.empty());
        return repo;
    }
}
