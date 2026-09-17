package com.acme.staticforge.benchmark;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.asset.UpdateAssetCommand;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.search.SearchIndexer;
import com.acme.staticforge.search.SearchService;
import com.acme.staticforge.search.SearchStatus;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Search benchmark (M23.5.1, §26.1): on a fixture of {@code N} pages (default 5,000) with rich-text bodies, sections
 * and prose drawn from a fixed vocabulary, all built through the real services on a filesystem index, it times
 *
 * <ul>
 *   <li>a full rebuild of the project's index (target &lt; 60 s);
 *   <li>200 representative queries through {@link SearchService} — uid prefixes, single words, phrases and
 *       type+folder filtered words — reporting p50/p95 (target p95 &lt; 150 ms);
 *   <li>the indexing lag while and after 100 page saves in a burst.
 * </ul>
 *
 * Off by default like {@code GenerationBenchmark}: enabled by {@code SF_PERF=true}, driven by
 * {@code infra/scripts/benchmark-search.sh}.
 */
@SpringBootTest
@ActiveProfiles("test")
@EnabledIf("perfEnabled")
class SearchBenchmark {

    private static final int DEFAULT_PAGES = 5000;
    private static final int QUERIES_PER_KIND = 50;
    private static final int BURST = 100;

    private static final String PAGE_CDL = """
            content {
              editor text intro { label "Intro" }
              editor richtext body { label "Body" }
            }
            bodies {
              body main { label "Main" allow ["*"] }
            }
            """;

    private static final String SECTION_CDL = """
            content {
              editor text headline { label "Headline" }
              editor textarea blurb { label "Blurb" }
            }
            """;

    /** Prose vocabulary: a mix of English and German words, so every analyzer does real work. */
    private static final List<String> WORDS = List.of(
            "harbour", "lighthouse", "keeper", "storm", "coast", "island", "ferry", "tide", "anchor", "sailor",
            "running", "houses", "gardens", "museum", "festival", "concert", "library", "market", "bridge", "river",
            "Häuser", "Gärten", "Wanderung", "Brücke", "Fluss", "Hafen", "Leuchtturm", "Sturm", "Küste", "Insel",
            "timetable", "ticket", "opening", "hours", "family", "children", "exhibition", "guided", "tour", "evening",
            "Öffnungszeiten", "Führung", "Ausstellung", "Familie", "Kinder", "Abend", "Konzert", "Markt", "Museum",
            "Bibliothek");

    private static Path indexRoot;

    @DynamicPropertySource
    static void configure(DynamicPropertyRegistry registry) throws IOException {
        indexRoot = Files.createTempDirectory("sf-search-perf-");
        registry.add("sf.search.directory", () -> "filesystem");
        registry.add("sf.search.index-root", indexRoot::toString);
    }

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired TemplateService templateService;
    @Autowired SearchService searchService;
    @Autowired SearchIndexer indexer;

    private final ObjectMapper mapper = new ObjectMapper();
    private final Random random = new Random(42);

    static boolean perfEnabled() {
        if ("true".equalsIgnoreCase(System.getProperty("sf.perf"))) {
            return true;
        }
        return "true".equalsIgnoreCase(System.getenv("SF_PERF"));
    }

    @Test
    void benchmarkRebuildQueriesAndLag() throws Exception {
        int pages = Integer.parseInt(config("sf.perf.pages", "SF_PERF_PAGES", String.valueOf(DEFAULT_PAGES)));

        AppUser user = userService.create("search-bench", "search-bench@example.com", "Search Benchmark", "password-1234");
        Project project = projectService.create(
                new CreateProjectRequest("searchbench", "Search Benchmark", null, "search benchmark"), user.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), user.getId(), "search benchmark");
        TemplateView template = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.PAGE_TEMPLATE, "Article", PAGE_CDL,
                Map.of("html", "<main>$CMS_VALUE(intro)$ $CMS_VALUE(body)$ $CMS_BODY(main)$</main>"), null, false,
                Map.of("html", "{displayNameSlug}.{ext}")), ctx);
        TemplateView section = templateService.create(new CreateTemplateCommand(
                project.getId(), AssetType.SECTION_TEMPLATE, "Teaser", SECTION_CDL,
                Map.of("html", "<h2>$CMS_VALUE(headline)$</h2><p>$CMS_VALUE(blurb)$</p>"), null, false, null), ctx);

        long fixtureStart = System.nanoTime();
        List<AssetVersionView> created = new ArrayList<>();
        for (int i = 0; i < pages; i++) {
            created.add(assetService.create(new CreateAssetCommand(
                    project.getId(), AssetType.PAGE, "Benchmark Page " + i, null, pagePayload(template.uuid(), section.uuid(), i),
                    null), ctx));
        }
        long fixtureMs = millisSince(fixtureStart);
        assertThat(indexer.awaitIdle(Duration.ofMinutes(10))).isTrue();

        // Full rebuild.
        long rebuildStart = System.nanoTime();
        assertThat(indexer.requestRebuild(project.getId())).isTrue();
        assertThat(indexer.awaitIdle(Duration.ofMinutes(10))).isTrue();
        long rebuildMs = millisSince(rebuildStart);
        SearchStatus afterRebuild = indexer.status(project.getId());
        assertThat(afterRebuild.lag()).isZero();

        // Queries: warm up, then 200 measured.
        List<Query> queries = queries(pages);
        for (Query query : queries.subList(0, 20)) {
            query.run(searchService, project.getId());
        }
        long[] all = new long[queries.size()];
        long[][] byKind = new long[4][QUERIES_PER_KIND];
        long totalHits = 0;
        for (int i = 0; i < queries.size(); i++) {
            long start = System.nanoTime();
            totalHits += queries.get(i).run(searchService, project.getId());
            long micros = (System.nanoTime() - start) / 1_000;
            all[i] = micros;
            byKind[i % 4][i / 4] = micros;
        }

        // Burst of saves: the lag while saving and how long the index takes to catch up afterwards.
        long burstStart = System.nanoTime();
        long maxLag = 0;
        for (int i = 0; i < BURST; i++) {
            AssetVersionView page = assetService.requireCurrent(project.getId(), created.get(i).uuid());
            ObjectNode payload = page.payload().deepCopy();
            payload.with("content").put("intro", "burst edit " + i + " " + word());
            assetService.update(page.uuid(), new UpdateAssetCommand(page.displayName(), payload), page.validFromRevision(), ctx);
            if (i % 10 == 9) {
                maxLag = Math.max(maxLag, indexer.status(project.getId()).lag());
            }
        }
        long burstMs = millisSince(burstStart);
        long settleStart = System.nanoTime();
        assertThat(indexer.awaitIdle(Duration.ofMinutes(5))).isTrue();
        long settleMs = millisSince(settleStart);
        assertThat(indexer.status(project.getId()).lag()).isZero();

        String summary = String.format(
                "pages=%d, fixtureMs=%d, rebuildMs=%d, queries=%d, totalHits=%d, p50Ms=%.1f, p95Ms=%.1f, maxMs=%.1f, "
                        + "uidPrefixP95Ms=%.1f, wordP95Ms=%.1f, phraseP95Ms=%.1f, filteredP95Ms=%.1f, burstSaves=%d, "
                        + "burstMs=%d, maxLagDuringBurst=%d, settleAfterBurstMs=%d, indexBytes=%d",
                pages, fixtureMs, rebuildMs, all.length, totalHits, percentile(all, 50), percentile(all, 95),
                percentile(all, 100), percentile(byKind[0], 95), percentile(byKind[1], 95), percentile(byKind[2], 95),
                percentile(byKind[3], 95), BURST, burstMs, maxLag, settleMs, directorySize(indexRoot));
        System.out.println("SFP_SEARCH_BENCH " + summary);
        writeSummary(summary);
    }

    private ObjectNode pagePayload(UUID template, UUID section, int index) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("templateRef", template.toString());
        ObjectNode content = payload.putObject("content");
        content.put("intro", sentence(8) + " " + index);
        content.putObject("body").put("format", "html").put("value", "<p>" + sentence(40) + "</p><p><strong>" + sentence(6)
                + "</strong> " + sentence(30) + "</p><ul><li>" + sentence(10) + "</li></ul>");
        ObjectNode instance = payload.putObject("bodies").putArray("main").addObject();
        instance.put("instanceId", UUID.randomUUID().toString());
        instance.put("templateRef", section.toString());
        instance.putObject("content").put("headline", sentence(5)).put("blurb", sentence(25));
        return payload;
    }

    private String sentence(int words) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < words; i++) {
            if (i > 0) {
                out.append(' ');
            }
            out.append(word());
        }
        return out.toString();
    }

    private String word() {
        return WORDS.get(random.nextInt(WORDS.size()));
    }

    private interface Query {
        long run(SearchService search, long projectId);
    }

    /** Round-robin uid prefix, single word, phrase and filtered word, 50 of each. */
    private List<Query> queries(int pages) {
        List<Query> queries = new ArrayList<>();
        for (int i = 0; i < QUERIES_PER_KIND; i++) {
            String uidPrefix = "benchmark_page_" + random.nextInt(Math.max(1, pages / 10));
            String single = word();
            String phrase = "\"" + word() + " " + word() + "\"";
            String filtered = word();
            queries.add((search, projectId) -> hits(search, projectId, uidPrefix, null, null));
            queries.add((search, projectId) -> hits(search, projectId, single, null, null));
            queries.add((search, projectId) -> hits(search, projectId, phrase, null, null));
            queries.add((search, projectId) -> hits(search, projectId, filtered, List.of("PAGE"), "/pages_root/"));
        }
        return queries;
    }

    private static long hits(SearchService search, long projectId, String q, List<String> types, String folder) {
        return search.search(projectId, q, types, folder, 0, 20, null).hits().totalHits();
    }

    private static double percentile(long[] micros, int percentile) {
        long[] sorted = micros.clone();
        Arrays.sort(sorted);
        int index = (int) Math.ceil(percentile / 100.0 * sorted.length) - 1;
        return sorted[Math.max(0, Math.min(sorted.length - 1, index))] / 1000.0;
    }

    private static long millisSince(long start) {
        return (System.nanoTime() - start) / 1_000_000L;
    }

    private static long directorySize(Path root) throws IOException {
        try (var walk = Files.walk(root)) {
            return walk.filter(Files::isRegularFile).mapToLong(p -> p.toFile().length()).sum();
        }
    }

    private void writeSummary(String summary) throws IOException {
        Path path = Path.of(config("sf.perf.out", "SF_PERF_OUT", "build/perf-results/search-summary.txt")).toAbsolutePath();
        Files.createDirectories(path.getParent());
        Files.writeString(path, summary + System.lineSeparator(), StandardCharsets.UTF_8);
        System.out.println("summary written to " + path);
    }

    private static String config(String property, String env, String fallback) {
        String value = System.getProperty(property);
        if (value == null || value.isBlank()) {
            value = System.getenv(env);
        }
        return value == null || value.isBlank() ? fallback : value;
    }
}
