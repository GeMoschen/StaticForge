package com.acme.staticforge;

import static com.acme.staticforge.QualityBuildFixtures.document;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import com.acme.staticforge.channel.ChannelService;
import com.acme.staticforge.channel.CreateChannelRequest;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationService;
import com.acme.staticforge.generate.GenerationTarget;
import com.acme.staticforge.generate.GenerationTargetRepository;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.generate.quality.rules.a11y.MissingAltRule;
import com.acme.staticforge.generate.quality.rules.links.EmptyLinkRule;
import com.acme.staticforge.generate.quality.rules.links.HeldBackTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingAnchorRule;
import com.acme.staticforge.generate.quality.rules.links.MissingLinkTargetRule;
import com.acme.staticforge.generate.quality.rules.links.MissingMediaRule;
import com.acme.staticforge.generate.quality.rules.links.RedirectedTargetRule;
import com.acme.staticforge.generate.quality.rules.links.UnreleasedTargetRule;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;

/**
 * {@code POST /projects/{key}/preview/pages/{uuid}/checks} (M30.3.1, epic decision 13): the page's draft rendered as a
 * build of the drafts would write it, with section markers, checked by the page rules and by the link rules against the
 * draft's planned paths; findings located in their section and field; completeness returned with them.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DraftCheckIntegrationTest {

    private static final AtomicInteger USERS = new AtomicInteger();

    private static Path outputRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        outputRoot = Files.createTempDirectory("sf-m30-draft-check");
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
    @Autowired ChannelService channelService;
    @Autowired QualityRuleConfigService configService;
    @Autowired RunFindingStore findingStore;
    @Autowired JwtService jwt;
    @Autowired MockMvc mvc;

    private QualityBuildFixtures q;

    @BeforeEach
    void setUp() {
        BuildInsightFixtures build = new BuildInsightFixtures(userService, projectService, assetService, assetRepository,
                templateService, mediaService, pageReferenceService, targetRepository, generationService, releaseFixtures,
                outputRoot);
        q = new QualityBuildFixtures(build, configService, findingStore, outputRoot);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private String token(AppUser user) {
        return jwt.issueAccessToken(userService.findById(user.getId()).orElseThrow());
    }

    private AppUser newUser(String prefix) {
        int n = USERS.incrementAndGet();
        return userService.create(prefix + "-" + n, prefix + "-" + n + "@example.com", prefix + " " + n, "secret-password");
    }

    /** Runs the draft check of {@code page} as the project's owner and returns the response. */
    private JsonNode check(Fixture fx, UUID page, String query) throws Exception {
        return check(fx, token(fx.user()), page, query, status().isOk());
    }

    private JsonNode check(Fixture fx, String token, UUID page, String query, ResultMatcher expected) throws Exception {
        String body = mvc.perform(post("/api/v1/projects/{key}/preview/pages/{uuid}/checks" + query,
                                fx.project().getKey(), page)
                        .header("Authorization", "Bearer " + token))
                .andExpect(expected)
                .andReturn()
                .getResponse()
                .getContentAsString();
        return body.isBlank() ? null : q.build.json(body);
    }

    private static List<JsonNode> findings(JsonNode response, String code) {
        List<JsonNode> found = new ArrayList<>();
        response.path("findings").forEach(finding -> {
            if (finding.path("code").asText().equals(code)) {
                found.add(finding);
            }
        });
        return found;
    }

    private static List<String> codes(JsonNode response) {
        List<String> codes = new ArrayList<>();
        response.path("findings").forEach(finding -> codes.add(finding.path("code").asText()));
        return codes;
    }

    private static String text(JsonNode node, String field) {
        return node.path(field).isNull() || node.path(field).isMissingNode() ? null : node.path(field).asText();
    }

    private ObjectNode link(UUID target) {
        return q.build.mapper.createObjectNode().put("kind", "INTERNAL").put("uuid", target.toString());
    }

    private void unpublish(Fixture fx, AssetVersionView page) {
        releaseService.unpublish(List.of(ReleaseItem.of(page.uuid())), RevisionContext.of(fx.projectId(), null, "test"));
    }

    /** A page template whose {@code main} body renders inside {@code <main>} of a complete document. */
    private TemplateView bodyTemplate(Fixture fx, String name) {
        return q.build.pageTemplate(fx, name, "bodies { body main { label \"Main\" allow [\"*\"] } }",
                document(name, "<main>$CMS_BODY(main)$</main>"));
    }

    // ------------------------------------------------------------------
    // Findings located in sections and fields
    // ------------------------------------------------------------------

    @Test
    void aMissingAltAndLinksToMissingPagesInSectionTwoAreFoundInSectionTwo() throws Exception {
        Fixture fx = q.project("dcsec");
        q.only(fx, List.of(MissingAltRule.CODE, MissingLinkTargetRule.CODE, EmptyLinkRule.CODE));
        AssetVersionView logo = q.build.media(fx, "logo.txt", "logo");
        TemplateView text = q.build.sectionTemplate(fx, "Text", "", "<p>intro</p>");
        TemplateView figure = q.build.sectionTemplate(fx, "Figure",
                "content { editor media image { label \"Image\" } editor link more { label \"More\" } }",
                "<figure><img src=\"$CMS_REF(image)$\"><a href=\"gone.html\">gone</a> "
                        + "<a href=\"$CMS_REF(more)$\">more</a></figure>");
        UUID nowhere = UUID.randomUUID();
        String[] instances = new String[2];
        AssetVersionView page = q.build.page(fx, "Home", bodyTemplate(fx, "Home").uuid(), payload -> {
            q.build.section(payload, "main", text.uuid());
            ObjectNode content = q.build.section(payload, "main", figure.uuid());
            content.set("image", q.build.mediaRef(logo.uuid()));
            content.set("more", link(nowhere));
            instances[0] = payload.path("bodies").path("main").path(0).path("instanceId").asText();
            instances[1] = payload.path("bodies").path("main").path(1).path("instanceId").asText();
        });

        JsonNode response = check(fx, page.uuid(), "");

        assertThat(response.path("checkedChannel").asText()).isEqualTo("html");
        assertThat(response.path("checkedLocale").isNull()).isTrue();
        assertThat(response.path("checkedPage").asInt()).isEqualTo(1);
        List<JsonNode> alt = findings(response, MissingAltRule.CODE);
        assertThat(alt).hasSize(1);
        assertThat(text(alt.get(0), "selector")).isEqualTo("body > main > figure > img");
        assertThat(text(alt.get(0), "sectionInstanceId")).isEqualTo(instances[1]);
        assertThat(text(alt.get(0), "editorPath")).isEqualTo("bodies.main[1].content.image");
        assertThat(text(alt.get(0), "name")).isEqualTo("Image without alt attribute");
        assertThat(text(alt.get(0), "category")).isEqualTo("ACCESSIBILITY");
        assertThat(text(alt.get(0), "severity")).isEqualTo("WARNING");
        assertThat(text(alt.get(0), "fixHint")).isEqualTo("CONTENT_OR_TEMPLATE");
        assertThat(text(alt.get(0), "message")).contains("media \"");
        assertThat(findings(response, MissingLinkTargetRule.CODE))
                .extracting(f -> text(f, "selector"), f -> text(f, "sectionInstanceId"), f -> text(f, "editorPath"))
                .containsExactlyInAnyOrder(
                        tuple("body > main > figure > a:nth-of-type(1)", instances[1], null),
                        tuple(null, instances[1], "bodies.main[1].content.more"));
        assertThat(findings(response, EmptyLinkRule.CODE)).as("the missing reference's empty href is 0101's").isEmpty();

        // The markers exist only in the check render: neither the preview nor a build writes them.
        String preview = mvc.perform(get("/api/v1/projects/{key}/preview/pages/{uuid}", fx.project().getKey(), page.uuid())
                        .header("Authorization", "Bearer " + token(fx.user())))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        assertThat(preview).contains("<figure>").doesNotContain("sf:section");
        GenerationTarget target = q.target(fx, "t");
        GenerationRun run = q.generate(fx, target, GenerationMode.FULL);
        assertThat(q.files(fx, target, run).get("home.html")).contains("<figure>").doesNotContain("sf:section");
    }

    @Test
    void aSectionRenderedInTheHeadIsNotMarkedAndItsFindingsHaveNoSection() throws Exception {
        Fixture fx = q.project("dchead");
        q.only(fx, List.of(MissingMediaRule.CODE));
        TemplateView page = q.build.pageTemplate(fx, "Layout",
                "bodies { body head { label \"Head\" allow [\"*\"] } body main { label \"Main\" allow [\"*\"] } }",
                "<!doctype html><html lang=\"en\"><head><title>Layout</title>$CMS_BODY(head)$</head><body><h1>Layout</h1>"
                        + "$CMS_BODY(main)$</body></html>");
        TemplateView style = q.build.sectionTemplate(fx, "Style", "", "<link rel=\"stylesheet\" href=\"missing.css\">");
        TemplateView image = q.build.sectionTemplate(fx, "Picture", "", "<p><img src=\"missing.png\" alt=\"\"></p>");
        String[] main = new String[1];
        AssetVersionView home = q.build.page(fx, "Home", page.uuid(), payload -> {
            q.build.section(payload, "head", style.uuid());
            q.build.section(payload, "main", image.uuid());
            main[0] = payload.path("bodies").path("main").path(0).path("instanceId").asText();
        });

        JsonNode response = check(fx, home.uuid(), "");

        assertThat(findings(response, MissingMediaRule.CODE))
                .extracting(f -> text(f, "selector"), f -> text(f, "sectionInstanceId"))
                .containsExactlyInAnyOrder(
                        tuple("head > link", null),
                        tuple("body > p > img", main[0]));
    }

    @Test
    void sectionsRenderedThroughAnInheritedLayoutBlockAreMarked() throws Exception {
        Fixture fx = q.project("dcext");
        q.only(fx, List.of(MissingAltRule.CODE));
        TemplateView base = q.build.pageTemplate(fx, "Base", "bodies { body main { label \"Main\" allow [\"*\"] } }",
                document("Base", "$CMS_BLOCK(content)$<p>base</p>$CMS_END_BLOCK$"));
        TemplateView article = q.build.pageTemplate(fx, "Article", "",
                "$CMS_EXTENDS(page_template:" + base.uid() + ")$"
                        + "$CMS_BLOCK(content)$<article>$CMS_BODY(main)$</article>$CMS_END_BLOCK$");
        TemplateView picture = q.build.sectionTemplate(fx, "Picture", "", "<img src=\"https://cdn.example.org/a.png\">");
        String[] instance = new String[1];
        AssetVersionView page = q.build.page(fx, "Guide", article.uuid(), payload -> {
            q.build.section(payload, "main", picture.uuid());
            instance[0] = payload.path("bodies").path("main").path(0).path("instanceId").asText();
        });

        JsonNode response = check(fx, page.uuid(), "");

        assertThat(findings(response, MissingAltRule.CODE))
                .extracting(f -> text(f, "selector"), f -> text(f, "sectionInstanceId"))
                .containsExactly(tuple("body > article > img", instance[0]));
    }

    // ------------------------------------------------------------------
    // Drafts are the view
    // ------------------------------------------------------------------

    @Test
    void aLinkToAnUnreleasedPageIsNoFindingOnTheDraftButIsOneInABuild() throws Exception {
        Fixture fx = q.project("dcrel");
        q.only(fx, List.of(UnreleasedTargetRule.CODE, MissingLinkTargetRule.CODE, EmptyLinkRule.CODE));
        AssetVersionView team = q.htmlPage(fx, "Team", document("Team", "<p>team</p>"));
        TemplateView template = q.build.pageTemplate(fx, "Linking",
                "content { editor link team { label \"Team\" } }",
                document("Linking", "<nav><a href=\"$CMS_REF(team)$\">team</a></nav>"));
        AssetVersionView linking = q.build.page(fx, "Linking", template.uuid(),
                payload -> payload.withObject("content").set("team", link(team.uuid())));
        GenerationTarget target = q.target(fx, "t");
        q.generate(fx, target, GenerationMode.FULL);
        unpublish(fx, team);

        GenerationRun build = q.generate(fx, target, GenerationMode.FULL);
        JsonNode draft = check(fx, linking.uuid(), "");

        // The build renders the released state: the link to the unpublished page renders empty and is reported.
        assertThat(q.findings(fx, build, UnreleasedTargetRule.CODE))
                .extracting(RunFindingStore.StoredFinding::outputPath)
                .containsExactly("linking.html");
        // The draft check renders the drafts, where the page exists and has its path: nothing to report.
        assertThat(codes(draft)).isEmpty();
    }

    @Test
    void aNoIndexDraftWithoutRobotsMetaIsReported() throws Exception {
        Fixture fx = q.project("dcnoindex");
        q.only(fx, List.of("SF-CHK-0212"));
        TemplateView template = q.build.pageTemplate(fx, "Hidden", "", document("Hidden", "<p>hidden</p>"));
        AssetVersionView hidden = q.build.page(fx, "Hidden", template.uuid(), payload -> {});
        assertThat(codes(check(fx, hidden.uuid(), ""))).isEmpty();

        q.build.edit(fx, hidden.uuid(), payload -> payload.withObject("nav").put("noIndex", true));

        assertThat(codes(check(fx, hidden.uuid(), ""))).containsExactly("SF-CHK-0212");
    }

    @Test
    void anHtmlCheckSkipsTheRulesThatNeedTheWholeBuild() throws Exception {
        Fixture fx = q.project("dcskip");
        AssetVersionView page = q.htmlPage(fx, "Home", document("Home", "<p>home</p>"));

        JsonNode response = check(fx, page.uuid(), "");

        List<String> skipped = new ArrayList<>();
        response.path("skippedRules").forEach(code -> skipped.add(code.asText()));
        assertThat(skipped).containsExactlyInAnyOrder(HeldBackTargetRule.CODE, RedirectedTargetRule.CODE, "SF-CHK-0205",
                "SF-CHK-0206", "SF-CHK-0210", MissingAnchorRule.CODE);
    }

    @Test
    void aNonHtmlChannelHasNoFindingsSkipsEveryRuleAndStillReportsCompleteness() throws Exception {
        Fixture fx = q.project("dcmd");
        channelService.create(new CreateChannelRequest(
                "markdown", "Markdown", "md", "text/markdown", "MARKDOWN", true, false, 1, null, null), fx.ctx());
        TemplateView template = q.build.pageTemplate(fx, "Article", "content { editor text headline { required } }",
                document("Article", "<p>$CMS_VALUE(headline)$</p>"));
        AssetVersionView article = q.build.page(fx, "Article", template.uuid());

        JsonNode response = check(fx, article.uuid(), "?channel=markdown");

        assertThat(response.path("checkedChannel").asText()).isEqualTo("markdown");
        assertThat(response.path("findings")).isEmpty();
        List<String> skipped = new ArrayList<>();
        response.path("skippedRules").forEach(code -> skipped.add(code.asText()));
        List<String> every = configService.effective(fx.projectId()).registry().all().stream().map(QualityRule::code).toList();
        assertThat(skipped).containsExactlyInAnyOrderElementsOf(every);
        assertThat(response.path("completeness")).extracting(issue -> issue.path("path").asText(),
                        issue -> issue.path("code").asText())
                .containsExactly(tuple("content.headline", "required"));
    }

    // ------------------------------------------------------------------
    // Access
    // ------------------------------------------------------------------

    @Test
    void viewersMayCheckNonMembersSeeNothingAndAnArchivedProjectStillChecksForAnInstanceAdmin() throws Exception {
        Fixture fx = q.project("dcacc");
        AssetVersionView page = q.htmlPage(fx, "Home", document("Home", "<p>home</p>"));
        AppUser viewer = newUser("dc-viewer");
        projectService.setMemberRole(fx.project().getKey(), viewer.getId(), ProjectRole.VIEWER, fx.ctx());
        AppUser stranger = newUser("dc-stranger");

        check(fx, token(viewer), page.uuid(), "", status().isOk());
        check(fx, token(stranger), page.uuid(), "", status().isNotFound());
        check(fx, token(fx.user()), UUID.randomUUID(), "", status().isNotFound());
        check(fx, token(fx.user()), page.uuid(), "?channel=nope", status().isBadRequest());

        projectService.archive(fx.project().getKey(), fx.ctx());

        // Only instance admins still see an archived project (M26); for them it is read-only, and a check reads only.
        int n = USERS.incrementAndGet();
        AppUser admin = userService.createInstanceAdmin(
                "dc-admin-" + n, "dc-admin-" + n + "@example.com", "dc admin " + n, "secret-password", false);
        mvc.perform(post("/api/v1/projects/{key}/preview/pages/{uuid}/checks", fx.project().getKey(), page.uuid())
                        .header("Authorization", "Bearer " + token(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.checkedChannel").value("html"));
    }
}
