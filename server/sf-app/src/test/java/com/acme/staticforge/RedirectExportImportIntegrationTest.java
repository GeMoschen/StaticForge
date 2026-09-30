package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.page.CreatePageCommand;
import com.acme.staticforge.asset.page.PageService;
import com.acme.staticforge.asset.template.CreateTemplateCommand;
import com.acme.staticforge.asset.template.TemplateService;
import com.acme.staticforge.asset.template.TemplateView;
import com.acme.staticforge.exportimport.ConflictReport;
import com.acme.staticforge.exportimport.ConflictType;
import com.acme.staticforge.exportimport.ExportSelection;
import com.acme.staticforge.exportimport.ImportConflict;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ImportResult;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.redirect.RedirectEntry;
import com.acme.staticforge.redirect.RedirectKind;
import com.acme.staticforge.redirect.RedirectRepository;
import com.acme.staticforge.redirect.RedirectService;
import com.acme.staticforge.redirect.RedirectService.AutoCandidate;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.template.cdl.CdlSources;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The redirect registry in export archives (M30.4.1, protocol {@code 10}): a full export carries every redirect, an
 * import adds those whose source path is free and reports the others ({@code REDIRECT_SOURCE_EXISTS},
 * {@code REDIRECT_INVALID}), a selective export carries none, and a protocol-9 archive imports without redirects.
 */
@SpringBootTest
@ActiveProfiles("test")
class RedirectExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";

    @Autowired ProjectExportImportService exportImportService;
    @Autowired ProjectService projects;
    @Autowired UserService users;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired RedirectService redirects;
    @Autowired RedirectRepository redirectRepository;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView template) {
        long id() {
            return project.getId();
        }
    }

    /** A source project with a manual page redirect, a manual URL redirect and an automatic one (page 2). */
    private record Source(Fixture fx, UUID a, UUID b) {}

    @Test
    @DisplayName("a full export carries every redirect; importing it recreates the registry with page targets kept")
    void roundTrip() throws Exception {
        Source src = source("rxr");
        byte[] archive = exportImportService.exportProject(src.fx().id());

        JsonNode archived = mapper.readTree(entry(archive, "redirects.json"));
        assertThat(archived).hasSize(3);
        assertThat(archived).extracting(r -> r.path("fromPath").asText())
                .containsExactly("ext.html", "moved.html", "old-a.html");
        assertThat(archived.get(1).has("createdByUsername")).as("AUTO entries have no creator").isFalse();
        assertThat(archived.get(2).path("createdByUsername").asText()).isEqualTo(src.fx().admin().getUsername());
        assertThat(mapper.readTree(entry(archive, "manifest.json")).path("protocolVersion").asInt()).isEqualTo(12);

        Fixture dst = fixture("rxd");
        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), archive, ImportOptions.DEFAULT);
        assertThat(analysis.redirectCount()).isEqualTo(3);
        assertThat(analysis.conflicts()).noneMatch(c -> c.type().name().startsWith("REDIRECT"));

        ImportResult result = exportImportService.importProject(dst.id(), archive, importCtx(dst), ImportOptions.DEFAULT);
        assertThat(result.importedRedirectCount()).isEqualTo(3);
        assertThat(result.redirectWarnings()).isEmpty();

        List<RedirectEntry> imported = redirectRepository.findByProjectIdOrderByChannelKeyAscLocaleKeyAscFromPathAsc(dst.id());
        assertThat(imported).extracting(RedirectEntry::getFromPath).containsExactly("ext.html", "moved.html", "old-a.html");
        RedirectEntry ext = imported.get(0);
        assertThat(ext.getKind()).isEqualTo(RedirectKind.MANUAL);
        assertThat(ext.getToPath()).isEqualTo("https://example.org/elsewhere");
        assertThat(ext.getCreatedBy()).isEqualTo(src.fx().admin().getId());
        RedirectEntry moved = imported.get(1);
        assertThat(moved.getKind()).isEqualTo(RedirectKind.AUTO);
        assertThat(moved.getToAssetUuid()).as("asset uuids survive the import").isEqualTo(src.b());
        assertThat(moved.getToPageNumber()).isEqualTo(2);
        assertThat(moved.getSourceRunId()).as("run ids mean nothing in another project").isNull();
        assertThat(moved.getCreatedBy()).isNull();
        assertThat(imported.get(2).getToAssetUuid()).isEqualTo(src.a());
        assertThat(imported).extracting(RedirectEntry::getLocaleKey).containsOnly("");
    }

    @Test
    @DisplayName("a source path the target already redirects is a REDIRECT_SOURCE_EXISTS warning: the target's redirect is kept")
    void conflictOnAnExistingSourcePath() throws Exception {
        Source src = source("rxc");
        byte[] archive = exportImportService.exportProject(src.fx().id());
        // A hand-edited archive entry for a channel the target doesn't have.
        byte[] edited = rewrite(archive, (name, text) -> name.equals("redirects.json")
                ? text.substring(0, text.length() - 1)
                        + ",{\"channel\":\"nope\",\"locale\":\"\",\"fromPath\":\"x.html\",\"toPath\":\"y.html\",\"kind\":\"MANUAL\"}]"
                : text);

        Fixture dst = fixture("rxcd");
        RedirectEntry existing = redirects.create(dst.id(),
                new RedirectService.Command("html", "", "ext.html", null, null, "mine.html"), dst.admin().getId());

        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), edited, ImportOptions.DEFAULT);
        assertThat(analysis.redirectCount()).isEqualTo(4);
        assertThat(analysis.blocksImport()).isFalse();
        assertThat(analysis.conflicts()).filteredOn(c -> c.type().name().startsWith("REDIRECT"))
                .extracting(ImportConflict::type, ImportConflict::elementLabel)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple(ConflictType.REDIRECT_SOURCE_EXISTS, "html: ext.html"),
                        org.assertj.core.groups.Tuple.tuple(ConflictType.REDIRECT_INVALID, "nope: x.html"));

        ImportResult result = exportImportService.importProject(dst.id(), edited, importCtx(dst), ImportOptions.DEFAULT);
        assertThat(result.importedRedirectCount()).isEqualTo(2);
        assertThat(result.redirectWarnings()).extracting(ImportConflict::type)
                .containsExactlyInAnyOrder(ConflictType.REDIRECT_SOURCE_EXISTS, ConflictType.REDIRECT_INVALID);
        assertThat(result.redirectWarnings()).allMatch(c -> c.detail().startsWith("Not imported: "));
        assertThat(redirectRepository.findById(existing.getId())).get()
                .satisfies(e -> {
                    assertThat(e.getToPath()).isEqualTo("mine.html");
                    assertThat(e.getVersion()).isEqualTo(existing.getVersion());
                });
        assertThat(redirectRepository.findByProjectIdOrderByChannelKeyAscLocaleKeyAscFromPathAsc(dst.id()))
                .extracting(RedirectEntry::getFromPath)
                .containsExactly("ext.html", "moved.html", "old-a.html");

        // Importing the same archive again adds nothing: every source path is taken now.
        ImportResult again = exportImportService.importProject(dst.id(), archive, importCtx(dst), ImportOptions.DEFAULT);
        assertThat(again.importedRedirectCount()).isZero();
        assertThat(again.redirectWarnings()).hasSize(3).allMatch(c -> c.type() == ConflictType.REDIRECT_SOURCE_EXISTS);
    }

    @Test
    @DisplayName("a protocol-9 archive imports without redirects; a selective export carries none")
    void olderArchivesAndSelections() throws Exception {
        Source src = source("rxo");
        byte[] archive = exportImportService.exportProject(src.fx().id());
        byte[] protocol9 = rewrite(archive, (name, text) -> name.equals("manifest.json")
                ? text.replaceAll("\"protocolVersion\":\\d+", "\"protocolVersion\":9")
                : text);
        assertThat(entries(protocol9)).containsKey("redirects.json");

        Fixture dst = fixture("rxod");
        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), protocol9, ImportOptions.DEFAULT);
        assertThat(analysis.redirectCount()).isZero();
        assertThat(analysis.blocksImport()).isFalse();
        ImportResult result = exportImportService.importProject(dst.id(), protocol9, importCtx(dst), ImportOptions.DEFAULT);
        assertThat(result.importedAssetCount()).isPositive();
        assertThat(result.importedRedirectCount()).isZero();
        assertThat(redirectRepository.findByProjectIdOrderByChannelKeyAscLocaleKeyAscFromPathAsc(dst.id())).isEmpty();

        byte[] selection = exportImportService.exportSelection(
                src.fx().id(), new ExportSelection(Set.of(src.a()), true, true, Set.of(), true));
        assertThat(entries(selection)).doesNotContainKey("redirects.json");
        assertThat(exportImportService.analyzeImport(dst.id(), selection, ImportOptions.DEFAULT).redirectCount()).isZero();
    }

    // ------------------------------------------------------------------

    private Source source(String prefix) {
        Fixture fx = fixture(prefix);
        UUID a = pages.create(new CreatePageCommand("a", null, fx.template().uuid()), fx.ctx()).uuid();
        UUID b = pages.create(new CreatePageCommand("b", null, fx.template().uuid()), fx.ctx()).uuid();
        long admin = fx.admin().getId();
        redirects.create(fx.id(), new RedirectService.Command("html", "", "old-a.html", a, null, null), admin);
        redirects.create(fx.id(), new RedirectService.Command("html", "", "ext.html", null, null,
                "https://example.org/elsewhere"), admin);
        redirects.upsertAuto(fx.id(), 99L, List.of(new AutoCandidate("html", "", "moved.html", b, 2)));
        return new Source(fx, a, b);
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        String key = prefix + n + "x" + (System.nanoTime() % 100_000);
        AppUser admin = users.create(key, key + "@example.com", "Admin", "secret-password");
        Project project = projects.create(new CreateProjectRequest(key, key, null, "redirect export"), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "redirect export");
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page", CdlSources.split(CDL),
                Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        return new Fixture(project, admin, ctx, template);
    }

    private static RevisionContext importCtx(Fixture fx) {
        return RevisionContext.of(fx.id(), fx.admin().getId(), "import");
    }

    private static Map<String, byte[]> entries(byte[] archive) throws IOException {
        Map<String, byte[]> out = new TreeMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                out.put(entry.getName(), zip.readAllBytes());
            }
        }
        return out;
    }

    private static String entry(byte[] archive, String name) throws IOException {
        byte[] bytes = entries(archive).get(name);
        if (bytes == null) {
            throw new AssertionError("No archive entry " + name);
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** {@code archive} with each JSON entry passed through {@code edit}. */
    private static byte[] rewrite(byte[] archive, BiFunction<String, String, String> edit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            for (Map.Entry<String, byte[]> e : entries(archive).entrySet()) {
                byte[] bytes = e.getValue();
                if (e.getKey().endsWith(".json")) {
                    bytes = edit.apply(e.getKey(), new String(bytes, StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
                }
                zip.putNextEntry(new ZipEntry(e.getKey()));
                zip.write(bytes);
                zip.closeEntry();
            }
        }
        return out.toByteArray();
    }
}
