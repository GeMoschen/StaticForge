package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.generate.GenerationMode;
import com.acme.staticforge.generate.GenerationRun;
import com.acme.staticforge.generate.GenerationRunRepository;
import com.acme.staticforge.generate.RunStatus;
import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.QualityProperties;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.RunFindingStore;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The stored findings of a run (M30.1.2, epic decisions 9 and 10): {@code GET /generations/{runId}/findings} paging,
 * every filter, the storage caps with the truncated count, the run view's counts, and another project's run.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RunFindingsApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired JwtService jwt;
    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired AssetService assets;
    @Autowired TemplateService templates;
    @Autowired GenerationRunRepository runs;
    @Autowired RunFindingStore store;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate tx;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, String token, RevisionContext ctx) {}

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser admin = users.create(prefix + n, prefix + n + "@example.com", "Admin", "secret-password");
        Project project = projects.create(
                new CreateProjectRequest(prefix + n, prefix + n, null, "findings"), admin.getId());
        return new Fixture(project, admin, jwt.issueAccessToken(users.findById(admin.getId()).orElseThrow()),
                RevisionContext.of(project.getId(), admin.getId(), "findings"));
    }

    private GenerationRun run(Fixture fx) {
        return runs.save(new GenerationRun(fx.project().getId(), null, GenerationMode.FULL, null, null, RunStatus.SUCCESS,
                Instant.now(), Instant.now(), fx.admin().getId(), 0, 0, 0, 0, 0, null, null));
    }

    private static Finding finding(OutputKey key, String code, QualityCategory category, QualitySeverity severity,
            String message) {
        return new Finding(key, code, category, severity, message, "body > p", null, false);
    }

    private ResultActions findings(Fixture fx, long runId, String query) throws Exception {
        return mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/generations/" + runId + "/findings"
                + (query.isEmpty() ? "" : "?" + query)).header("Authorization", "Bearer " + fx.token()));
    }

    @Test
    void findingsArePagedFilteredAndNameTheirPageAsItIsNow() throws Exception {
        Fixture fx = fixture("rf");
        TemplateView template = templates.create(new CreateTemplateCommand(fx.project().getId(), AssetType.PAGE_TEMPLATE,
                "Plain", "", Map.of("html", "<p>x</p>"), null, false, null), fx.ctx());
        com.fasterxml.jackson.databind.node.ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", template.uuid().toString());
        payload.putObject("content");
        AssetVersionView page = assets.create(
                new CreateAssetCommand(fx.project().getId(), AssetType.PAGE, "Home", null, payload, null), fx.ctx());
        UUID gone = UUID.randomUUID();
        OutputKey home = new OutputKey("de/home.html", page.uuid(), "html", "de", null);
        OutputKey homeEn = new OutputKey("en/home.html", page.uuid(), "html", "en", null);
        OutputKey old = new OutputKey("de/news/old-2.html", gone, "html", "de", 2);
        GenerationRun run = run(fx);
        RunFindingStore.Counts counts = tx.execute(status -> store.save(run.getId(), List.of(
                finding(home, "SF-CHK-0201", QualityCategory.SEO, QualitySeverity.WARNING, "no title"),
                finding(home, "SF-CHK-0301", QualityCategory.ACCESSIBILITY, QualitySeverity.ERROR, "no alt"),
                finding(homeEn, "SF-CHK-0301", QualityCategory.ACCESSIBILITY, QualitySeverity.WARNING, "no alt en"),
                finding(old, "SF-CHK-0101", QualityCategory.LINKS, QualitySeverity.WARNING, "missing page")
                        .carriedTo(old))));
        assertThat(counts.errors()).isEqualTo(1);
        assertThat(counts.warnings()).isEqualTo(3);
        assertThat(counts.truncated()).isZero();
        tx.executeWithoutResult(status -> {
            GenerationRun stored = runs.findById(run.getId()).orElseThrow();
            counts.applyTo(stored);
            runs.save(stored);
        });

        findings(fx, run.getId(), "")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.totalElements").value(4))
                .andExpect(jsonPath("$.content[*].outputPath",
                        contains("de/home.html", "de/home.html", "de/news/old-2.html", "en/home.html")))
                .andExpect(jsonPath("$.content[*].code", contains("SF-CHK-0201", "SF-CHK-0301", "SF-CHK-0101", "SF-CHK-0301")))
                .andExpect(jsonPath("$.content[0].page.uid").value(page.uid()))
                .andExpect(jsonPath("$.content[0].page.displayName").value("Home"))
                .andExpect(jsonPath("$.content[0].selector").value("body > p"))
                .andExpect(jsonPath("$.content[0].locale").value("de"))
                .andExpect(jsonPath("$.content[2].page.uuid").value(gone.toString()))
                .andExpect(jsonPath("$.content[2].page.uid").value(nullValue()))
                .andExpect(jsonPath("$.content[2].page.displayName").value(nullValue()))
                .andExpect(jsonPath("$.content[2].pageNumber").value(2))
                .andExpect(jsonPath("$.content[2].carried").value(true));

        findings(fx, run.getId(), "size=2&page=1")
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.content[0].outputPath").value("de/news/old-2.html"))
                .andExpect(jsonPath("$.page.totalPages").value(2));
        findings(fx, run.getId(), "severity=ERROR").andExpect(jsonPath("$.content[*].message", contains("no alt")));
        findings(fx, run.getId(), "category=accessibility")
                .andExpect(jsonPath("$.content[*].message", contains("no alt", "no alt en")));
        findings(fx, run.getId(), "code=SF-CHK-0201&code=SF-CHK-0101")
                .andExpect(jsonPath("$.content[*].message", contains("no title", "missing page")));
        findings(fx, run.getId(), "assetUuid=" + gone).andExpect(jsonPath("$.content[*].message", contains("missing page")));
        findings(fx, run.getId(), "locale=en").andExpect(jsonPath("$.content[*].message", contains("no alt en")));
        findings(fx, run.getId(), "channel=markdown").andExpect(jsonPath("$.content", hasSize(0)));
        findings(fx, run.getId(), "pathPrefix=de/news/").andExpect(jsonPath("$.content[*].message", contains("missing page")));
        // The prefix is literal: "_" is no wildcard.
        findings(fx, run.getId(), "pathPrefix=de_").andExpect(jsonPath("$.content", hasSize(0)));

        findings(fx, run.getId(), "severity=OFF").andExpect(status().isBadRequest());
        findings(fx, run.getId(), "category=style").andExpect(status().isBadRequest());
        findings(fx, run.getId(), "size=201").andExpect(status().isBadRequest());

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/generations/" + run.getId())
                        .header("Authorization", "Bearer " + fx.token()))
                .andExpect(jsonPath("$.findingCounts.errors").value(1))
                .andExpect(jsonPath("$.findingCounts.warnings").value(3))
                .andExpect(jsonPath("$.findingCounts.truncated").value(0))
                .andExpect(jsonPath("$.findingCounts.byCategory.links").value(1))
                .andExpect(jsonPath("$.findingCounts.byCategory.seo").value(1))
                .andExpect(jsonPath("$.findingCounts.byCategory.accessibility").value(2));
    }

    @Test
    void aRunOfAnotherProjectIsNotFoundAndARunBeforeM30HasNoCounts() throws Exception {
        Fixture mine = fixture("rfa");
        Fixture other = fixture("rfb");
        GenerationRun theirs = run(other);

        findings(mine, theirs.getId(), "").andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/projects/" + other.project().getKey() + "/generations/" + theirs.getId())
                        .header("Authorization", "Bearer " + other.token()))
                .andExpect(jsonPath("$.findingCounts").value(nullValue()));
    }

    @Test
    void theCapsStoreErrorsFirstAndCountWhatTheyDrop() {
        Fixture fx = fixture("rfc");
        GenerationRun run = run(fx);
        QualityProperties caps = new QualityProperties();
        caps.setMaxFindingsPerOutput(2);
        caps.setMaxFindingsPerRun(5);
        RunFindingStore capped = new RunFindingStore(jdbc, caps);
        List<Finding> findings = new ArrayList<>();
        for (int page = 0; page < 3; page++) {
            OutputKey key = new OutputKey("p" + page + ".html", null, "html", null, null);
            for (int i = 0; i < 3; i++) {
                findings.add(finding(key, "SF-CHK-0301", QualityCategory.ACCESSIBILITY, QualitySeverity.WARNING, "w" + i));
            }
        }
        findings.add(finding(new OutputKey("p2.html", null, "html", null, null), "SF-CHK-0201", QualityCategory.SEO,
                QualitySeverity.ERROR, "e"));

        RunFindingStore.Counts counts = tx.execute(status -> capped.save(run.getId(), findings));

        assertThat(counts.errors()).isEqualTo(1);
        assertThat(counts.warnings()).isEqualTo(9);
        assertThat(counts.byCategory()).containsExactlyInAnyOrderEntriesOf(Map.of(
                QualityCategory.ACCESSIBILITY, 9, QualityCategory.SEO, 1, QualityCategory.LINKS, 0));
        assertThat(counts.truncated()).as("10 findings: 3 over the per-output cap, then 2 over the per-run cap").isEqualTo(5);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT output_path, severity FROM generation_run_finding WHERE run_id = ? ORDER BY id", run.getId());
        assertThat(rows).hasSize(5);
        assertThat(rows.get(0).get("severity")).isEqualTo("ERROR");
        assertThat(rows.stream().map(row -> row.get("output_path")).toList())
                .containsExactly("p2.html", "p0.html", "p0.html", "p1.html", "p1.html");
    }
}
