package com.acme.staticforge.urlregistry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionRepository;
import com.acme.staticforge.asset.navigation.LiveNavigationLookup;
import com.acme.staticforge.asset.navigation.NavigationService;
import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.OutputPathExpander;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionService;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * {@link UrlRegistryServiceImpl} against mock collaborators (`M8.2.2`, every target since M32.2): assign once,
 * derived page-reference URLs, pagination next to page 1's registered URL, override validation and collisions, and the
 * reset dispatch with its change records. Behavior against real assets is covered by the sf-app integration tests.
 */
class UrlRegistryServiceImplTest {

    private static final long PROJECT_ID = 42L;
    private static final UUID PAGE_REF = UUID.randomUUID();
    private static final UUID PAGE = UUID.randomUUID();
    private static final UUID OTHER_PAGE = UUID.randomUUID();
    /** Non-default settings, so the stubs prove the channel's own settings reach the URL computation. */
    private static final ChannelOutputSettings PRETTY =
            new ChannelOutputSettings("html", null, null, ChannelOutputSettings.UrlStrategy.PRETTY, true);

    private UrlRegistryRepository repository;
    private UrlRegistryChangeRepository changes;
    private NavigationService navigationService;
    private LiveOutputPathResolver outputPathResolver;
    private RevisionService revisionService;
    private ChannelService channelService;
    private AssetRepository assetRepository;
    private UrlRegistryServiceImpl service;
    private final RevisionContext ctx = RevisionContext.of(PROJECT_ID, 1L, null);

    @BeforeEach
    void setUp() {
        repository = mock(UrlRegistryRepository.class);
        changes = mock(UrlRegistryChangeRepository.class);
        navigationService = mock(NavigationService.class);
        outputPathResolver = mock(LiveOutputPathResolver.class);
        revisionService = mock(RevisionService.class);
        LiveNavigationLookup lookup = mock(LiveNavigationLookup.class);
        channelService = mock(ChannelService.class);
        assetRepository = mock(AssetRepository.class);
        com.acme.staticforge.project.ProjectLocales projectLocales = mock(com.acme.staticforge.project.ProjectLocales.class);
        when(projectLocales.forProject(PROJECT_ID)).thenReturn(com.acme.staticforge.project.LocaleConfig.EMPTY);
        service = new UrlRegistryServiceImpl(
                repository, changes, navigationService, lookup, outputPathResolver, revisionService, channelService,
                projectLocales, mock(com.acme.staticforge.project.ProjectWriteGuard.class), assetRepository,
                mock(AssetVersionRepository.class), mock(org.springframework.jdbc.core.JdbcTemplate.class));

        when(navigationService.resolve(eq(PROJECT_ID), eq(PAGE_REF), any())).thenReturn(PAGE);
        when(channelService.outputSettings(PROJECT_ID, "html")).thenReturn(PRETTY);
        when(outputPathResolver.resolvePath(PROJECT_ID, PAGE, "html", PRETTY, OutputPathExpander.LocaleContext.NONE))
                .thenReturn(Optional.of("products/hammer/index.html"));
        when(revisionService.findRecent(eq(PROJECT_ID), any())).thenReturn(List.of());
        when(repository.findTuple(anyLong(), any(), any(), any(), any(), any(), any(), anyInt())).thenReturn(Optional.empty());
        when(repository.findByProjectIdAndChannelKeyAndAreaAndLocaleKeyAndUrl(anyLong(), any(), any(), any(), any()))
                .thenReturn(Optional.empty());
    }

    @Test
    void firstResolveInsertsIfAbsentAndReturnsTheRowReadBack() {
        // The read-back returns whichever row won — here a concurrent caller's, with a different URL.
        when(repository.findTuple(PROJECT_ID, "html", UrlArea.GENERATED, "", UrlTargetType.PAGE, PAGE, "", 1))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(entry(UrlTarget.page(PAGE), "winner/hammer/")));

        String url = service.resolvePage(PAGE, 1, "html", UrlArea.GENERATED, null, ctx);

        assertThat(url).isEqualTo("winner/hammer/");
        verify(repository).insertIfAbsent(eq(PROJECT_ID), eq("html"), eq("GENERATED"), eq(""), eq("PAGE"), eq(PAGE),
                eq(""), eq(1), eq("products/hammer/"), any(), eq(0L), eq(false));
        verify(repository, never()).save(any());
    }

    @Test
    void resolveReturnsTheExistingUrlWithoutComputing() {
        when(repository.findTuple(PROJECT_ID, "html", UrlArea.GENERATED, "", UrlTargetType.PAGE, PAGE, "", 1))
                .thenReturn(Optional.of(entry(UrlTarget.page(PAGE), "cached/url.html")));

        String url = service.resolvePage(PAGE, 1, "html", UrlArea.GENERATED, null, ctx);

        assertThat(url).isEqualTo("cached/url.html");
        verify(outputPathResolver, never()).resolvePath(anyLong(), any(), any(), any(), any());
        verify(repository, never()).insertIfAbsent(anyLong(), any(), any(), any(), any(), any(), any(), anyInt(), any(),
                any(), anyLong(), anyBoolean());
    }

    @Test
    void aTakenUrlIsReturnedButNotStored() {
        // insertIfAbsent inserts nothing (another target holds the URL) and nothing reads back.
        String url = service.resolve(UrlTarget.page(PAGE), "html", UrlArea.PREVIEW, "", () -> "taken.html", ctx);

        assertThat(url).isEqualTo("taken.html");
    }

    @Test
    void aPageReferenceUsesItsPagesUrlAndHasNoRowOfItsOwn() {
        when(repository.findTuple(PROJECT_ID, "html", UrlArea.GENERATED, "", UrlTargetType.PAGE, PAGE, "", 1))
                .thenReturn(Optional.of(entry(UrlTarget.page(PAGE), "about/")));

        assertThat(service.resolvePageReference(PAGE_REF, "html", UrlArea.GENERATED, null, ctx)).isEqualTo("about/");
        verify(repository, never()).findTuple(anyLong(), any(), any(), any(), any(), eq(PAGE_REF), any(), anyInt());
    }

    @Test
    void laterPagesOfAPaginatedPageSitNextToPageOnesRegisteredUrl() {
        when(repository.findTuple(PROJECT_ID, "html", UrlArea.PREVIEW, "", UrlTargetType.PAGE, PAGE, "", 1))
                .thenReturn(Optional.of(entry(UrlTarget.page(PAGE), "old/blog/")));
        when(outputPathResolver.resolvePaginationPath(
                        PROJECT_ID, PAGE, "html", PRETTY, OutputPathExpander.LocaleContext.NONE, "old/blog/index.html", 2))
                .thenReturn(Optional.of("old/blog/index-2.html"));

        service.resolvePage(PAGE, 2, "html", UrlArea.PREVIEW, null, ctx);

        verify(repository).insertIfAbsent(eq(PROJECT_ID), eq("html"), eq("PREVIEW"), eq(""), eq("PAGE"), eq(PAGE),
                eq(""), eq(2), eq("old/blog/index-2.html"), any(), eq(0L), eq(false));
    }

    @Test
    void overrideRefusesAUrlAnotherTargetHolds() {
        page(PAGE);
        when(repository.findByProjectIdAndChannelKeyAndAreaAndLocaleKeyAndUrl(
                        PROJECT_ID, "html", UrlArea.GENERATED, "", "about.html"))
                .thenReturn(Optional.of(entry(UrlTarget.page(OTHER_PAGE), "about.html")));

        assertThatThrownBy(() -> service.override(UrlTarget.page(PAGE), "html", UrlArea.GENERATED, "", "/about.html", ctx))
                .isInstanceOf(SfException.class)
                .satisfies(e -> {
                    assertThat(((SfException) e).getStatus()).isEqualTo(409);
                    assertThat(((SfException) e).getProblem().getExtensions()).containsEntry("code", "SF-DOM-0200")
                            .containsEntry("holderUuid", OTHER_PAGE.toString());
                });
    }

    @Test
    void overrideRefusesUrlsOutsideTheSiteOrOfTheWrongFileType() {
        page(PAGE);
        for (String bad : List.of("../secret.html", "https://example.com/a.html", "a b.html", "about.txt", "a?b=1.html",
                "  ")) {
            assertThatThrownBy(() -> service.override(UrlTarget.page(PAGE), "html", UrlArea.GENERATED, "", bad, ctx))
                    .as(bad)
                    .isInstanceOf(SfException.class)
                    .satisfies(e -> assertThat(((SfException) e).getProblem().getExtensions())
                            .containsEntry("code", "SF-DOM-0201"));
        }
    }

    @Test
    void overrideRefusesAPageReference() {
        Asset reference = mock(Asset.class);
        when(reference.getAssetType()).thenReturn(AssetType.PAGE_REFERENCE);
        when(assetRepository.findByProjectIdAndUuid(PROJECT_ID, PAGE_REF)).thenReturn(Optional.of(reference));

        assertThatThrownBy(() -> service.override(UrlTarget.page(PAGE_REF), "html", UrlArea.GENERATED, "", "a.html", ctx))
                .isInstanceOf(SfException.class)
                .satisfies(e -> assertThat(((SfException) e).getProblem().getDetail()).contains("uses the URL of its page"));
    }

    @Test
    void overrideStoresTheNormalizedUrlAsAnOverrideAndRecordsAChange() {
        page(PAGE);
        when(repository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        UrlRegistryEntry saved = service.override(UrlTarget.page(PAGE), "html", UrlArea.GENERATED, "", "/team/", ctx);

        assertThat(saved.getUrl()).isEqualTo("team/");
        assertThat(saved.isOverridden()).isTrue();
        verify(changes).save(any(UrlRegistryChange.class));
    }

    @Test
    void resetScopesDispatchToTheirDeletesAndRecordChanges() {
        service.reset(PROJECT_ID, ResetScope.channel("html"), ctx);
        verify(repository).deleteByProjectIdAndChannelKey(PROJECT_ID, "html");
        service.reset(PROJECT_ID, ResetScope.area(UrlArea.PREVIEW), ctx);
        verify(repository).deleteByProjectIdAndArea(PROJECT_ID, UrlArea.PREVIEW);
        service.reset(PROJECT_ID, ResetScope.project(), ctx);
        verify(repository).deleteByProjectId(PROJECT_ID);
        service.reset(PROJECT_ID, ResetScope.asset(PAGE, UrlArea.GENERATED), ctx);
        verify(repository).deleteByProjectIdAndTargetUuidAndArea(PROJECT_ID, PAGE, UrlArea.GENERATED);
        verify(changes, times(4)).save(any(UrlRegistryChange.class));
    }

    private void page(UUID uuid) {
        Asset asset = mock(Asset.class);
        when(asset.getAssetType()).thenReturn(AssetType.PAGE);
        when(assetRepository.findByProjectIdAndUuid(PROJECT_ID, uuid)).thenReturn(Optional.of(asset));
    }

    private static UrlRegistryEntry entry(UrlTarget target, String url) {
        return new UrlRegistryEntry(PROJECT_ID, "html", target, UrlArea.GENERATED, "", url, Instant.now(), 1L, false);
    }
}
