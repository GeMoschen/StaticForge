package com.acme.staticforge;

import static com.acme.staticforge.QualityBuildFixtures.document;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.hamcrest.Matchers.hasItems;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.BuildInsightFixtures.Fixture;
import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.asset.navigation.PageReferenceService;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.asset.template.UpdateTemplateCommand;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.quality.RunFindingStore.StoredFinding;
import com.acme.staticforge.generate.quality.rules.links.DeletedTargetRule;
import com.acme.staticforge.generate.quality.rules.links.EmptyLinkRule;
import com.acme.staticforge.generate.quality.rules.links.HeldBackTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingAnchorRule;
import com.acme.staticforge.generate.quality.rules.links.MissingLinkTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingMediaRule;
import com.acme.staticforge.generate.quality.rules.links.OtherChannelTargetRule;
import com.acme.staticforge.generate.quality.rules.links.RedirectedTargetRule;
import com.acme.staticforge.generate.quality.rules.links.UnreleasedTargetRule;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.security.JwtService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The link rules {@code SF-CHK-0101}–{@code 0109} in real builds (M30.2.1): reference events from the renderer with the
 * field that holds the reference, carried outputs checked afresh in incremental runs (and never held back), and links
 * to a page held back for incomplete content. Each project runs only the link rules.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LinkRulesIntegrationTest {

    private static final List<String> LINK_RULES = List.of(
            MissingLinkTargetRule.CODE, MissingMediaRule.CODE, HeldBackTargetRule.CODE, UnreleasedTargetRule.CODE,
            DeletedTargetRule.CODE, OtherChannelTargetRule.CODE, MissingAnchorRule.CODE, EmptyLinkRule.CODE,
            RedirectedTargetRule.CODE);

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-links");
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
    @Autowired ReleaseFixtures releaseFixtures;
    @Autowired ReleaseService releaseService;
    @Autowired QualityRuleConfigService configService;
    @Autowired RunFindingStore findingStore;
    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;

    private QualityBuildFixtures q;

    @BeforeEach
    void setUp() {
        BuildInsightFixtures build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository,
                templateService, mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures,
                outputRoot);
        q = new QualityBuildFixtures(build, configService, findingStore, outputRoot);
    }

    private Fixture project(String prefix) {
        Fixture fx = q.project(prefix);
        q.only(fx, LINK_RULES);
        return fx;
    }

    private void unpublish(Fixture fx, AssetVersionView page) {
        releaseService.unpublish(List.of(ReleaseItem.of(page.uuid())), RevisionContext.of(fx.projectId(), null, "test"));
    }

    private static ObjectNode link(QualityBuildFixtures q, UUID target) {
        return q.build.mapper.createObjectNode().put("kind", "INTERNAL").put("uuid", target.toString());
    }

    private List<StoredFinding> linkFindings(Fixture fx, GenerationRun run) {
        return q.findings(fx, run).stream().filter(finding -> LINK_RULES.contains(finding.code())).toList();
    }

    @Test
    void everyLinkRuleIsListedByTheRulesEndpoint() throws Exception {
        Fixture fx = q.project("lkapi");
        String token = jwt.issueAccessToken(userService.findById(fx.user().getId()).orElseThrow());

        mvc.perform(get("/api/v1/projects/{key}/quality-rules", fx.project().getKey())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rules[?(@.category == 'LINKS')].code", hasItems(LINK_RULES.toArray())))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0101')].kind").value("SITE"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0101')].name").value("Link to a missing page or file"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0101')].maxSeverity").value("ERROR"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0103')].maxSeverity").value("WARNING"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0108')].kind").value("PAGE"))
                .andExpect(jsonPath("$.rules[?(@.code == 'SF-CHK-0109')].severity").value("WARNING"));
    }

    @Test
    void referencesToUnreleasedDeletedAndMissingPagesAreFindingsOnTheLinkingPageNamingTheTargetAndTheField() {
        Fixture fx = project("lkref");
        AssetVersionView team = q.htmlPage(fx, "Team", document("Team", "<h2 id=\"people\">People</h2>"));
        AssetVersionView old = q.htmlPage(fx, "Old", document("Old", "<p>old</p>"));
        UUID nowhere = UUID.randomUUID();
        TemplateView template = q.build.pageTemplate(fx, "Linking",
                "content { editor link team { label \"Team\" } editor link old { label \"Old\" } "
                        + "editor link nowhere { label \"Nowhere\" } }",
                document("Linking", "<nav><a href=\"$CMS_REF(team)$\">team</a> <a href=\"$CMS_REF(old)$\">old</a> "
                        + "<a href=\"$CMS_REF(nowhere)$\">nowhere</a> <a href=\"team.html#people\">people</a> "
                        + "<a href=\"team.html#staff\">staff</a> <a href=\"/gone.html\">gone</a></nav>"));
        q.build.page(fx, "Linking", template.uuid(), payload -> {
            ObjectNode content = payload.withObject("content");
            content.set("team", link(q, team.uuid()));
            content.set("old", link(q, old.uuid()));
            content.set("nowhere", link(q, nowhere));
        });
        GenerationTarget target = q.target(fx, "t");
        GenerationRun first = q.generate(fx, target, GenerationMode.FULL);
        assertThat(linkFindings(fx, first)).extracting(StoredFinding::code, StoredFinding::message).containsExactly(
                tuple(MissingLinkTargetRule.CODE, "Link to '/gone.html' (gone.html): no page or file of this build is "
                        + "there."),
                tuple(MissingLinkTargetRule.CODE, "Reference to a page that doesn't exist (" + nowhere + ") in field "
                        + "content.nowhere: it renders an empty link."),
                tuple(MissingAnchorRule.CODE, "Missing anchor: 'team.html#staff' — page '" + team.uid() + "' has no "
                        + "element with id or name 'staff'."));

        unpublish(fx, team);
        assetService.softDelete(old.uuid(), true, fx.ctx());
        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        // The render warnings stay as they were (SF-GEN-0220/0221 make the run PARTIAL); nothing fails or is held back.
        assertThat(run.getStatus()).as("diagnostics: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getDiagnostics().path("errors")).isEmpty();
        assertThat(q.files(fx, target, run).get("linking.html"))
                .contains("<a href=\"\">team</a> <a href=\"\">old</a> <a href=\"\">nowhere</a>");
        assertThat(linkFindings(fx, run))
                .extracting(StoredFinding::outputPath, StoredFinding::code, StoredFinding::selector, StoredFinding::message)
                .containsExactlyInAnyOrder(
                        tuple("linking.html", MissingLinkTargetRule.CODE, "body > nav > a:nth-of-type(6)",
                                "Link to '/gone.html' (gone.html): no page or file of this build is there."),
                        tuple("linking.html", MissingLinkTargetRule.CODE, null, "Reference to a page that doesn't exist ("
                                + nowhere + ") in field content.nowhere: it renders an empty link."),
                        tuple("linking.html", MissingLinkTargetRule.CODE, "body > nav > a:nth-of-type(4)",
                                "Link to 'team.html#people' (team.html): no page or file of this build is there."),
                        tuple("linking.html", MissingLinkTargetRule.CODE, "body > nav > a:nth-of-type(5)",
                                "Link to 'team.html#staff' (team.html): no page or file of this build is there."),
                        tuple("linking.html", UnreleasedTargetRule.CODE, null, "Link to unreleased page '" + team.uid()
                                + "' (PAGE) in field content.team: it renders an empty link until the target is "
                                + "released."),
                        tuple("linking.html", DeletedTargetRule.CODE, null, "Link to deleted page '" + old.uid()
                                + "' (PAGE) in field content.old: it renders empty."));
        assertThat(q.findings(fx, run, EmptyLinkRule.CODE)).as("the empty hrefs are the references'").isEmpty();
        StoredFinding unreleased = q.findings(fx, run, UnreleasedTargetRule.CODE).get(0);
        assertThat(unreleased.channel()).isEqualTo("html");
        assertThat(unreleased.carried()).isFalse();
    }

    @Test
    void aCarriedPageReportsItsLinkToAnUnpublishedPageFreshAndIsNeverHeldBack() {
        Fixture fx = project("lkcarry");
        q.htmlPage(fx, "A", document("A", "<a href=\"b.html\">b</a>"));
        AssetVersionView b = q.htmlPage(fx, "B", document("B", "<p>b</p>"));
        q.configure(fx, Map.of(MissingLinkTargetRule.CODE, QualitySeverity.ERROR));
        GenerationTarget target = q.target(fx, "t");
        GenerationRun first = q.generate(fx, target, GenerationMode.FULL);
        assertThat(linkFindings(fx, first)).isEmpty();

        unpublish(fx, b);
        GenerationRun second = q.generate(fx, target, GenerationMode.INCREMENTAL);

        assertThat(second.getPlanSummary().path("incremental").asBoolean()).as("summary: %s", second.getPlanSummary())
                .isTrue();
        assertThat(second.getPlanSummary().path("pageCount").asInt()).as("A is carried, not rendered").isZero();
        assertThat(linkFindings(fx, second))
                .extracting(StoredFinding::outputPath, StoredFinding::code, StoredFinding::severity,
                        StoredFinding::carried, StoredFinding::message)
                .containsExactly(tuple("a.html", MissingLinkTargetRule.CODE, QualitySeverity.ERROR, false,
                        "Link to 'b.html': no page or file of this build is there."));
        assertThat(second.getStatus()).as("an error on a carried page holds nothing back: %s", second.getDiagnostics())
                .isEqualTo(RunStatus.SUCCESS);
        assertThat(q.files(fx, target, second)).containsKey("a.html").doesNotContainKey("b.html");
    }

    @Test
    void aCarriedPageKeepsReportingItsReferenceToAnUnreleasedPage() {
        Fixture fx = project("lkevents");
        AssetVersionView team = q.htmlPage(fx, "Team", document("Team", ""));
        TemplateView template = q.build.pageTemplate(fx, "Linking", "content { editor link team }",
                document("Linking", "<a href=\"$CMS_REF(team)$\">team</a>"));
        q.build.page(fx, "Linking", template.uuid(), payload -> payload.withObject("content").set("team",
                link(q, team.uuid())));
        AssetVersionView other = q.htmlPage(fx, "Other", document("Other", "<p>v1</p>"));
        GenerationTarget target = q.target(fx, "t");
        q.generate(fx, target, GenerationMode.FULL);
        unpublish(fx, team);
        GenerationRun unpublished = q.generate(fx, target, GenerationMode.INCREMENTAL);
        assertThat(q.findings(fx, unpublished, UnreleasedTargetRule.CODE)).extracting(StoredFinding::outputPath)
                .containsExactly("linking.html");
        assertThat(q.sidecar(fx, target, unpublished).orElseThrow().entry("linking.html").orElseThrow().references())
                .extracting(ReferenceEvent::kind, ReferenceEvent::target, ReferenceEvent::editorPath)
                .containsExactly(tuple(ReferenceEvent.Kind.UNRELEASED, team.uuid(), "content.team"));

        // Only the other page changes: the linking page is carried with its reference events.
        q.build.updateTemplate(fx, UUID.fromString(q.build.current(fx, other.uuid()).payload().path("templateRef")
                .asText()), document("Other", "<p>v2</p>"), "{displayNameSlug}.{ext}");
        GenerationRun carried = q.generate(fx, target, GenerationMode.INCREMENTAL);

        assertThat(carried.getPlanSummary().path("incremental").asBoolean()).isTrue();
        assertThat(carried.getPlanSummary().path("pageCount").asInt()).as("only the other page is rendered").isEqualTo(1);
        assertThat(q.findings(fx, carried, UnreleasedTargetRule.CODE))
                .extracting(StoredFinding::outputPath, StoredFinding::carried, StoredFinding::message)
                .containsExactly(tuple("linking.html", false, "Link to unreleased page '" + team.uid()
                        + "' (PAGE) in field content.team: it renders an empty link until the target is released."));
        assertThat(q.findings(fx, carried, EmptyLinkRule.CODE)).isEmpty();
    }

    @Test
    void aLinkToAPageHeldBackForIncompleteContentIsAWarningEvenWhenConfiguredAsError() {
        Fixture fx = project("lkheld");
        q.htmlPage(fx, "Home", document("Home", "<a href=\"article.html\">article</a>"));
        String articleHtml = document("Article", "<p>$CMS_VALUE(title)$</p>");
        TemplateView article = q.build.pageTemplate(fx, "Article", "content { editor text title }", articleHtml);
        q.build.page(fx, "Article", article.uuid());
        releaseFixtures.releaseAll(fx.projectId());
        // Templates are live: making the title required leaves the released article incomplete (SF-GEN-0120).
        templateService.update(article.uuid(), new UpdateTemplateCommand("Article",
                "content { editor text title { required } }", Map.of("html", articleHtml), null, false,
                Map.of("html", "{displayNameSlug}.{ext}"), false, Map.of()),
                templateService.get(fx.projectId(), article.uuid()).validFromRevision(), fx.ctx());
        q.configure(fx, Map.of(HeldBackTargetRule.CODE, QualitySeverity.ERROR));
        GenerationTarget target = q.target(fx, "t");

        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);

        assertThat(run.getStatus()).as("SF-GEN-0120 only: %s", run.getDiagnostics()).isEqualTo(RunStatus.PARTIAL);
        assertThat(run.getDiagnostics().path("errors")).extracting(error -> error.path("code").asText())
                .containsExactly("SF-GEN-0120");
        assertThat(q.files(fx, target, run)).containsKey("home.html").doesNotContainKey("article.html");
        assertThat(linkFindings(fx, run))
                .extracting(StoredFinding::outputPath, StoredFinding::code, StoredFinding::severity, StoredFinding::message)
                .containsExactly(tuple("home.html", HeldBackTargetRule.CODE, QualitySeverity.WARNING,
                        "Link to 'article.html': the page is held back in this build."));
    }
}
