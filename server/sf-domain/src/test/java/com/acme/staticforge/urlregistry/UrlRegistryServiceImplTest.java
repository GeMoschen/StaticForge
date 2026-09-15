package com.acme.staticforge.urlregistry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * {@link UrlRegistryServiceImpl} tests against mock collaborators (`M8.2.2`) — focuses on logic
 * that doesn't need a live database: first-{@code resolve} insert-if-absent-then-reread, and the {@link ResetScope} dispatch to the correct repository delete method. Full
 * read-through-cache/override/reset-then-recompute behavior against real assets/navigation is
 * covered by {@code UrlRegistryServiceIntegrationTest} (sf-app), including a real concurrent race.
 */
class UrlRegistryServiceImplTest {

    private static final long PROJECT_ID = 42L;
    private static final UUID PAGE_REF = UUID.randomUUID();
    private static final UUID PAGE = UUID.randomUUID();

    private UrlRegistryRepository repository;
    private NavigationService navigationService;
    private LiveOutputPathResolver outputPathResolver;
    private RevisionService revisionService;
    private UrlRegistryServiceImpl service;

    @BeforeEach
    void setUp() {
        repository = mock(UrlRegistryRepository.class);
        navigationService = mock(NavigationService.class);
        outputPathResolver = mock(LiveOutputPathResolver.class);
        revisionService = mock(RevisionService.class);
        LiveNavigationLookup lookup = mock(LiveNavigationLookup.class);
        service = new UrlRegistryServiceImpl(repository, navigationService, lookup, outputPathResolver, revisionService);

        when(navigationService.resolve(eq(PROJECT_ID), eq(PAGE_REF), any())).thenReturn(PAGE);
        when(outputPathResolver.resolveUrl(eq(PROJECT_ID), eq(PAGE), eq("html"), any(), anyBoolean(), any()))
                .thenReturn(Optional.of("products/hammer.html"));
        when(revisionService.findRecent(eq(PROJECT_ID), any())).thenReturn(List.of());
    }

    @Test
    void firstResolveInsertsIfAbsentAndReturnsTheRowReadBack() {
        RevisionContext ctx = RevisionContext.of(PROJECT_ID, 1L, null);
        // The read-back returns whichever row won — here a concurrent caller's, with a different URL.
        when(repository.findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(PROJECT_ID, "html", PAGE_REF, UrlArea.GENERATED))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(entry("winner/hammer.html")));
        when(repository.insertIfAbsent(anyLong(), any(), any(), any(), any(), any(), anyLong())).thenReturn(0);

        String url = service.resolve(PAGE_REF, "html", UrlArea.GENERATED, ctx);

        assertThat(url).isEqualTo("winner/hammer.html");
        verify(repository).insertIfAbsent(
                eq(PROJECT_ID), eq("html"), eq(PAGE_REF), eq("GENERATED"), eq("products/hammer.html"), any(), eq(0L));
        verify(repository, never()).save(any());
        verify(repository, times(2))
                .findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(PROJECT_ID, "html", PAGE_REF, UrlArea.GENERATED);
    }

    @Test
    void resolveReturnsTheExistingUrlWithoutRecomputingOrSaving() {
        RevisionContext ctx = RevisionContext.of(PROJECT_ID, 1L, null);
        when(repository.findByProjectIdAndChannelKeyAndPageReferenceUuidAndArea(PROJECT_ID, "html", PAGE_REF, UrlArea.GENERATED))
                .thenReturn(Optional.of(entry("cached/url.html")));

        String url = service.resolve(PAGE_REF, "html", UrlArea.GENERATED, ctx);

        assertThat(url).isEqualTo("cached/url.html");
        verify(navigationService, never()).resolve(anyLong(), any(), any());
        verify(repository, never()).insertIfAbsent(anyLong(), any(), any(), any(), any(), any(), anyLong());
    }

    @Test
    void resetEntryScopeCallsDeleteById() {
        service.reset(PROJECT_ID, ResetScope.entry(7L), RevisionContext.of(PROJECT_ID, 1L, null));
        verify(repository).deleteById(7L);
    }

    @Test
    void resetChannelScopeCallsDeleteByProjectIdAndChannelKey() {
        service.reset(PROJECT_ID, ResetScope.channel("html"), RevisionContext.of(PROJECT_ID, 1L, null));
        verify(repository).deleteByProjectIdAndChannelKey(PROJECT_ID, "html");
    }

    @Test
    void resetAreaScopeCallsDeleteByProjectIdAndArea() {
        service.reset(PROJECT_ID, ResetScope.area(UrlArea.PREVIEW), RevisionContext.of(PROJECT_ID, 1L, null));
        verify(repository).deleteByProjectIdAndArea(PROJECT_ID, UrlArea.PREVIEW);
    }

    @Test
    void resetProjectScopeCallsDeleteByProjectId() {
        service.reset(PROJECT_ID, ResetScope.project(), RevisionContext.of(PROJECT_ID, 1L, null));
        verify(repository).deleteByProjectId(PROJECT_ID);
    }

    private static UrlRegistryEntry entry(String url) {
        return new UrlRegistryEntry(PROJECT_ID, "html", PAGE_REF, UrlArea.GENERATED, url, Instant.now(), 1L, false);
    }
}
