package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRequest;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.TargetType;
import com.acme.staticforge.generate.insight.FallbackCause;
import com.acme.staticforge.generate.insight.RebuildEdgeKind;
import com.acme.staticforge.generate.insight.RebuildReason;
import com.acme.staticforge.generate.insight.RebuildRootKind;
import com.acme.staticforge.generate.insight.RebuildStep;
import com.acme.staticforge.generate.plan.BuildPlan;
import com.acme.staticforge.generate.plan.PlanEntry;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Reason chains (M22.1.1): every planned entry says why it is in the build, change-driven entries by the shortest chain
 * back to the change, and the §18.2 navigation rule rebuilds the pages rendering a changed navigation.
 */
@SpringBootTest
@ActiveProfiles("test")
class RebuildReasonsIntegrationTest {

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m22-reasons-test");
        registry.add("sf.generate.output-root", outputRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired TemplateService templateService;
    @Autowired MediaService mediaService;
    @Autowired PageReferenceService pageReferenceService;
    @Autowired GenerationTargetRepository targetRepository;
    @Autowired GenerationService generationService;

    private BuildInsightFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new BuildInsightFixtures(userService, projectService, assetService, assetRepository, templateService,
                mediaService, pageReferenceService, targetRepository, generationService, outputRoot);
    }

    private BuildPlan plan(Fixture fx, GenerationTarget target, GenerationMode mode) {
        return plan(fx, new GenerationRequest(mode, null, List.of("html"), target.getId(), null, null, null, null));
    }

    private BuildPlan plan(Fixture fx, GenerationRequest request) {
        return generationService.planFor(fx.project().getKey(), request).plan();
    }

    private static List<UUID> plannedPages(BuildPlan plan) {
        return plan.entries().stream().map(PlanEntry::pageUuid).distinct().toList();
    }

    /** A page with a teaser section (the teaser links a media file) and a page linking the media directly. */
    private record Content(
            Fixture fx, GenerationTarget target, AssetVersionView hero, TemplateView teaser, AssetVersionView home,
            AssetVersionView about, AssetVersionView legal) {}

    private Content content(String prefix) {
        Fixture fx = fixtures.project(prefix);
        AssetVersionView hero = fixtures.media(fx, "hero.txt", "HERO");
        TemplateView teaser = fixtures.sectionTemplate(fx, "Teaser", "", "<a href=\"$CMS_REF(media:hero_txt)$\">hero</a>");
        TemplateView article = fixtures.pageTemplate(fx, "Article",
                "bodies { body main { label \"Main\" allow [\"*\"] } }", "<main>$CMS_BODY(main)$</main>");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        AssetVersionView home = fixtures.page(fx, "Home", article.uuid(), payload -> fixtures.section(payload, "main", teaser.uuid()));
        AssetVersionView about = fixtures.page(fx, "About", plain.uuid(),
                payload -> payload.withObject("content").set("hero", fixtures.mediaRef(hero.uuid())));
        AssetVersionView legal = fixtures.page(fx, "Legal", plain.uuid());
        GenerationTarget target = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        return new Content(fx, target, hero, teaser, home, about, legal);
    }

    @Test
    void fullFallbackAndExplicitScopeAreTheirOwnRootKinds() {
        Content c = content("m22roots");
        Fixture fx = c.fx();

        BuildPlan full = plan(fx, c.target(), GenerationMode.FULL);
        assertThat(full.entries()).hasSize(3);
        assertThat(plannedPages(full)).allSatisfy(page -> assertThat(full.reasonFor(page))
                .isEqualTo(RebuildReason.of(RebuildRootKind.FULL_BUILD, null, null, null, null)));

        BuildPlan fallback = plan(fx, c.target(), GenerationMode.INCREMENTAL);
        assertThat(fallback.incremental()).isFalse();
        assertThat(fallback.fallbackCause()).isEqualTo(FallbackCause.NO_COMPLETE_BUILD_FOR_TARGET);
        assertThat(fallback.reasonFor(c.legal().uuid()).rootKind()).isEqualTo(RebuildRootKind.INCREMENTAL_FALLBACK_FULL);
        assertThat(fallback.reasonFor(c.legal().uuid()).fallbackCause()).isEqualTo(FallbackCause.NO_COMPLETE_BUILD_FOR_TARGET);

        BuildPlan scoped = plan(fx, new GenerationRequest(GenerationMode.FULL, null, List.of("html"), c.target().getId(), null,
                List.of(c.about().uuid()), null, null));
        assertThat(plannedPages(scoped)).containsExactly(c.about().uuid());
        RebuildReason explicit = scoped.reasonFor(c.about().uuid());
        assertThat(explicit.rootKind()).isEqualTo(RebuildRootKind.EXPLICIT_SCOPE);
        assertThat(explicit.rootUid()).isEqualTo("about");
    }

    @Test
    void changeDrivenReasonsAreTheShortestChainAndCountEveryChange() {
        Content c = content("m22chains");
        Fixture fx = c.fx();
        fixtures.succeeded(fixtures.generate(fx, c.target(), GenerationMode.FULL));

        // The media file changes: the page linking it directly (one hop), the page placing the teaser (two hops).
        AssetVersionView hero = fixtures.rename(fx, c.hero().uuid(), "Hero image");
        BuildPlan plan = plan(fx, c.target(), GenerationMode.INCREMENTAL);
        assertThat(plan.incremental()).isTrue();
        assertThat(plannedPages(plan)).containsExactlyInAnyOrder(c.home().uuid(), c.about().uuid());

        RebuildReason about = plan.reasonFor(c.about().uuid());
        assertThat(about.rootKind()).isEqualTo(RebuildRootKind.ASSET_CHANGED);
        assertThat(about.rootUuid()).isEqualTo(c.hero().uuid());
        assertThat(about.rootRevision()).isEqualTo(hero.validFromRevision());
        assertThat(about.causeCount()).isEqualTo(1);
        assertThat(about.steps()).singleElement().isEqualTo(new RebuildStep(
                c.about().uuid(), "PAGE", "about", RebuildEdgeKind.REFERENCE, "MEDIA_REF", "content.hero"));

        RebuildReason home = plan.reasonFor(c.home().uuid());
        assertThat(home.steps()).containsExactly(
                new RebuildStep(c.home().uuid(), "PAGE", "home", RebuildEdgeKind.SECTION_TEMPLATE, null,
                        "bodies.main[0].templateRef"),
                new RebuildStep(c.teaser().uuid(), "SECTION_TEMPLATE", c.teaser().uid(), RebuildEdgeKind.REFERENCE, "OCTL_REF",
                        "channelTemplates.html"));
        assertThat(plan.reasonFor(c.hero().uuid())).as("media isn't planned").isNull();

        // The teaser changes too: the shortest chain to home now starts at the teaser, and both changes count.
        fixtures.updateTemplate(fx, c.teaser().uuid(), "<a href=\"$CMS_REF(media:hero_txt)$\">hero v2</a>", null);
        BuildPlan both = plan(fx, c.target(), GenerationMode.INCREMENTAL);
        RebuildReason homeAgain = both.reasonFor(c.home().uuid());
        assertThat(homeAgain.rootUuid()).isEqualTo(c.teaser().uuid());
        assertThat(homeAgain.steps()).extracting(RebuildStep::edge).containsExactly(RebuildEdgeKind.SECTION_TEMPLATE);
        assertThat(homeAgain.causeCount()).isEqualTo(2);
        assertThat(both.reasonFor(c.about().uuid()).causeCount()).isEqualTo(1);

        // A changed page is its own root.
        AssetVersionView legal = fixtures.edit(fx, c.legal().uuid(), payload -> payload.withObject("content").put("note", "x"));
        BuildPlan withPage = plan(fx, c.target(), GenerationMode.INCREMENTAL);
        assertThat(withPage.reasonFor(c.legal().uuid())).isEqualTo(new RebuildReason(RebuildRootKind.ASSET_CHANGED,
                c.legal().uuid(), "PAGE", "legal", legal.validFromRevision(), 1, null, List.of()));

        // Planning the same state twice explains it identically.
        assertThat(plan(fx, c.target(), GenerationMode.INCREMENTAL).reasons()).isEqualTo(withPage.reasons());
    }

    @Test
    void aDeletedRootIsReportedAsDeleted() {
        Content c = content("m22deleted");
        Fixture fx = c.fx();
        fixtures.succeeded(fixtures.generate(fx, c.target(), GenerationMode.FULL));

        assetService.softDelete(c.hero().uuid(), true, fx.ctx());
        BuildPlan plan = plan(fx, c.target(), GenerationMode.INCREMENTAL);

        assertThat(plannedPages(plan)).containsExactlyInAnyOrder(c.home().uuid(), c.about().uuid());
        assertThat(plan.reasonFor(c.about().uuid()).rootKind()).isEqualTo(RebuildRootKind.ASSET_DELETED);
    }

    @Test
    void catalogCardsReachThePageOverContentReferences() {
        Content c = content("m22catalog");
        Fixture fx = c.fx();
        TemplateView plain = fixtures.pageTemplate(fx, "Cards", "", "<p>cards</p>");
        AssetVersionView cards = fixtures.page(fx, "Cards page", plain.uuid(), payload -> {
            ObjectNode catalog = payload.withObject("content").putObject("cards").put("type", "CATALOG");
            ObjectNode card = catalog.putArray("cards").addObject();
            card.put("instanceId", UUID.randomUUID().toString());
            card.put("templateRef", c.teaser().uuid().toString());
            card.putObject("content");
        });
        fixtures.succeeded(fixtures.generate(fx, c.target(), GenerationMode.FULL));

        fixtures.updateTemplate(fx, c.teaser().uuid(), "<p>teaser v2</p>", null);
        RebuildReason reason = plan(fx, c.target(), GenerationMode.INCREMENTAL).reasonFor(cards.uuid());

        assertThat(reason.rootUuid()).isEqualTo(c.teaser().uuid());
        assertThat(reason.steps()).singleElement().isEqualTo(new RebuildStep(
                cards.uuid(), "PAGE", cards.uid(), RebuildEdgeKind.REFERENCE, "CONTENT_REF", "content.cards.cards[0].templateRef"));
    }

    @Test
    void aNavigationChangeRebuildsEveryPageRenderingTheNavigation() {
        Fixture fx = fixtures.project("m22nav");
        TemplateView navTemplate = fixtures.pageTemplate(fx, "With nav", "", "<nav>$CMS_NAVIGATION(nav:root)$</nav>");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        AssetVersionView one = fixtures.page(fx, "One", navTemplate.uuid());
        AssetVersionView two = fixtures.page(fx, "Two", navTemplate.uuid());
        AssetVersionView target = fixtures.page(fx, "Target", plain.uuid());
        AssetVersionView link = fixtures.pageReference(fx, "Target link", fixtures.navigationRoot(fx), target.uuid());
        GenerationTarget site = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        fixtures.succeeded(fixtures.generate(fx, site, GenerationMode.FULL));

        // Relabel the page reference: the pages rendering the navigation rebuild, the target page doesn't.
        fixtures.edit(fx, link.uuid(), payload -> payload.put("label", "Go to target"));
        BuildPlan relabelled = plan(fx, site, GenerationMode.INCREMENTAL);
        assertThat(plannedPages(relabelled)).containsExactlyInAnyOrder(one.uuid(), two.uuid());
        RebuildReason reason = relabelled.reasonFor(one.uuid());
        assertThat(reason.rootUuid()).isEqualTo(link.uuid());
        assertThat(reason.steps()).extracting(RebuildStep::edge)
                .containsExactly(RebuildEdgeKind.PAGE_TEMPLATE, RebuildEdgeKind.REFERENCE, RebuildEdgeKind.NAVIGATION);
        assertThat(reason.steps().get(2).assetUuid()).isEqualTo(fixtures.navigationRoot(fx));
        GenerationRun afterRelabel = fixtures.succeeded(fixtures.generate(fx, site, GenerationMode.INCREMENTAL));
        assertThat(fixtures.files(fx, site, afterRelabel).get("one.html")).contains("Go to target");

        // A body edit of the target doesn't show in navigation; renaming it does (the label falls back to it).
        fixtures.edit(fx, link.uuid(), payload -> payload.putNull("label"));
        fixtures.succeeded(fixtures.generate(fx, site, GenerationMode.INCREMENTAL));
        fixtures.edit(fx, target.uuid(), payload -> payload.withObject("content").put("note", "x"));
        assertThat(plannedPages(plan(fx, site, GenerationMode.INCREMENTAL))).containsExactly(target.uuid());
        fixtures.rename(fx, target.uuid(), "Target renamed");
        BuildPlan renamed = plan(fx, site, GenerationMode.INCREMENTAL);
        assertThat(plannedPages(renamed)).containsExactlyInAnyOrder(one.uuid(), two.uuid(), target.uuid());
        assertThat(renamed.reasonFor(two.uuid()).steps()).extracting(RebuildStep::assetType)
                .containsExactly("PAGE", "PAGE_TEMPLATE", "FOLDER", "PAGE_REFERENCE");
        assertThat(renamed.reasonFor(two.uuid()).rootUuid()).isEqualTo(target.uuid());
    }

    @Test
    void movedOutputsAndUidChangesReachThePagesLinkingThem() {
        Fixture fx = fixtures.project("m22moved");
        TemplateView movable = fixtures.pageTemplate(fx, "Movable", "", "<p>moved</p>");
        TemplateView plain = fixtures.pageTemplate(fx, "Plain", "", "<p>plain</p>");
        AssetVersionView moved = fixtures.page(fx, "Moved", movable.uuid());
        TemplateView linking = fixtures.pageTemplate(fx, "Linking", "", "<a href=\"$CMS_REF(page:moved)$\">moved</a>");
        AssetVersionView linker = fixtures.page(fx, "Linker", linking.uuid());
        AssetVersionView legal = fixtures.page(fx, "Legal", plain.uuid());
        GenerationTarget site = fixtures.target(fx, "site", TargetType.FILESYSTEM);
        fixtures.succeeded(fixtures.generate(fx, site, GenerationMode.FULL));

        fixtures.updateTemplate(fx, movable.uuid(), "<p>moved</p>", "sub/{displayNameSlug}.{ext}");
        BuildPlan plan = plan(fx, site, GenerationMode.INCREMENTAL);
        assertThat(plannedPages(plan)).containsExactlyInAnyOrder(moved.uuid(), linker.uuid());
        assertThat(plan.reasonFor(linker.uuid()).steps()).extracting(RebuildStep::assetUuid)
                .containsExactly(linker.uuid(), linking.uuid(), moved.uuid());
        GenerationRun run = fixtures.succeeded(fixtures.generate(fx, site, GenerationMode.INCREMENTAL));
        assertThat(fixtures.files(fx, site, run)).containsKey("sub/moved.html").doesNotContainKey("moved.html");
        assertThat(fixtures.files(fx, site, run).get("linker.html")).contains("href=\"sub/moved.html\"");

        // A uid change writes no asset version, but moves the default output path: it is a change.
        assetService.changeUid(legal.uuid(), "imprint", fx.ctx());
        BuildPlan renamed = plan(fx, site, GenerationMode.INCREMENTAL);
        assertThat(plannedPages(renamed)).containsExactly(legal.uuid());
        assertThat(renamed.reasonFor(legal.uuid()).rootKind()).isEqualTo(RebuildRootKind.ASSET_CHANGED);
        assertThat(renamed.reasonFor(legal.uuid()).rootRevision()).isGreaterThan(run.getRevisionId());
    }

    @Test
    void anOutputTheBaseBuildLacksIsPlannedAgain() throws IOException {
        Content c = content("m22missing");
        Fixture fx = c.fx();
        GenerationRun full = fixtures.succeeded(fixtures.generate(fx, c.target(), GenerationMode.FULL));
        Path manifest = fixtures.targetDir(fx, c.target()).resolve("builds").resolve(full.getId() + ".manifest.json");
        ObjectNode json = (ObjectNode) fixtures.json(Files.readString(manifest));
        ArrayNode outputs = (ArrayNode) json.get("outputs");
        for (int i = 0; i < outputs.size(); i++) {
            if (outputs.get(i).path("path").asText().equals("legal.html")) {
                outputs.remove(i);
                break;
            }
        }
        Files.writeString(manifest, json.toString());

        BuildPlan plan = plan(fx, c.target(), GenerationMode.INCREMENTAL);

        assertThat(plan.incremental()).isTrue();
        assertThat(plannedPages(plan)).containsExactly(c.legal().uuid());
        assertThat(plan.reasonFor(c.legal().uuid()))
                .isEqualTo(RebuildReason.of(RebuildRootKind.NOT_IN_BASE_BUILD, null, c.legal().uuid(), "PAGE", "legal"));
    }
}
