package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.folder.FolderScope;
import com.acme.staticforge.asset.folder.FolderService;
import com.acme.staticforge.asset.folder.StartPage;
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
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.urlregistry.LiveOutputPathResolver;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
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
 * Folder start pages in export archives (M31.4, protocol {@code 11}): a folder's start page travels in its payload,
 * the site root's is merged into the target's {@code pages_root} when that has none, a different one there is kept
 * with a {@code START_PAGE_NOT_MERGED} warning, and a protocol-10 archive imports as before.
 */
@SpringBootTest
@ActiveProfiles("test")
class FolderStartPageExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String CDL = "content { editor text title { label \"Title\" } }";

    @Autowired ProjectExportImportService exportImportService;
    @Autowired ProjectService projects;
    @Autowired UserService users;
    @Autowired AssetService assets;
    @Autowired FolderService folders;
    @Autowired PageService pages;
    @Autowired TemplateService templates;
    @Autowired LiveOutputPathResolver livePaths;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, AppUser admin, RevisionContext ctx, TemplateView template, UUID pagesRoot) {
        long id() {
            return project.getId();
        }
    }

    /** {@code homepage} is the site's start page, {@code overview} the start page of folder {@code products}. */
    private record Source(Fixture fx, UUID homepage, UUID products, UUID overview, UUID hammer) {}

    @Test
    @DisplayName("a full round trip keeps the start page of a folder and of the site root")
    void fullRoundTrip() throws Exception {
        Source src = source("spx");
        byte[] archive = exportImportService.exportProject(src.fx().id());
        assertThat(mapper.readTree(entry(archive, "manifest.json")).path("protocolVersion").asInt()).isEqualTo(11);
        assertThat(mapper.readTree(entry(archive, "assets/" + src.products() + ".json")).path("payload")
                .path(StartPage.PAYLOAD_KEY).asText()).isEqualTo(src.overview().toString());

        Fixture dst = fixture("spxd");
        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), archive, ImportOptions.DEFAULT);
        assertThat(analysis.conflicts()).extracting(ImportConflict::type).doesNotContain(ConflictType.START_PAGE_NOT_MERGED);
        exportImportService.importProject(dst.id(), archive, importCtx(dst), ImportOptions.DEFAULT);

        assertThat(startPageOf(dst, src.products())).isEqualTo(src.overview());
        assertThat(startPageOf(dst, dst.pagesRoot())).isEqualTo(src.homepage());
        // Effective in the target: the pages are there, in their folders.
        assertThat(livePaths.startPageOf(dst.id(), src.products())).isEqualTo(src.overview());
        assertThat(livePaths.startPageOf(dst.id(), dst.pagesRoot())).isEqualTo(src.homepage());

        // Importing the same archive again changes nothing: the target already has that start page.
        ConflictReport again = exportImportService.analyzeImport(dst.id(), archive, ImportOptions.DEFAULT);
        assertThat(again.conflicts()).extracting(ImportConflict::type).doesNotContain(ConflictType.START_PAGE_NOT_MERGED);
    }

    @Test
    @DisplayName("selective exports: a picked start page brings the site root's pointer along; a folder keeps its own; "
            + "a site start page that isn't imported is reported, not set")
    void selectiveRoundTrips() throws Exception {
        Source src = source("sps");

        byte[] homepageOnly = exportImportService.exportSelection(
                src.fx().id(), new ExportSelection(Set.of(src.homepage(), src.fx().template().uuid()), false, false, Set.of(), false));
        Fixture first = fixture("spsa");
        exportImportService.importProject(first.id(), homepageOnly, importCtx(first), ImportOptions.DEFAULT);
        assertThat(startPageOf(first, first.pagesRoot())).isEqualTo(src.homepage());

        byte[] productsOnly = exportImportService.exportSelection(
                src.fx().id(), new ExportSelection(Set.of(src.products(), src.fx().template().uuid()), false, false, Set.of(), false));
        Fixture second = fixture("spsb");
        ConflictReport analysis = exportImportService.analyzeImport(second.id(), productsOnly, ImportOptions.DEFAULT);
        assertThat(analysis.blocksImport()).isFalse();
        assertThat(analysis.conflicts()).filteredOn(c -> c.type() == ConflictType.START_PAGE_NOT_MERGED)
                .singleElement()
                .satisfies(c -> {
                    assertThat(c.elementUuid()).isEqualTo(src.homepage().toString());
                    // Neither the archive nor the target knows the page: it is named by its uuid.
                    assertThat(c.detail()).isEqualTo("The archive's site start page '" + src.homepage()
                            + "' won't be a page of the site root after the import; the target's site root gets no start page.");
                });
        exportImportService.importProject(second.id(), productsOnly, importCtx(second), ImportOptions.DEFAULT);
        assertThat(startPageOf(second, src.products())).isEqualTo(src.overview());
        assertThat(startPageOf(second, second.pagesRoot())).isNull();
    }

    @Test
    @DisplayName("a target whose site root has another start page keeps it: START_PAGE_NOT_MERGED warning")
    void aDifferentTargetStartPageIsKept() throws Exception {
        Source src = source("spc");
        byte[] archive = exportImportService.exportProject(src.fx().id());
        Fixture dst = fixture("spcd");
        UUID landing = pages.create(new CreatePageCommand("Landing", null, dst.template().uuid()), dst.ctx()).uuid();
        setStartPage(dst, dst.pagesRoot(), landing);

        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), archive, ImportOptions.DEFAULT);
        assertThat(analysis.blocksImport()).isFalse();
        assertThat(analysis.conflicts()).filteredOn(c -> c.type() == ConflictType.START_PAGE_NOT_MERGED)
                .singleElement()
                .satisfies(c -> assertThat(c.detail()).isEqualTo(
                        "The target's site root keeps its start page 'Landing'; the archive's start page 'Homepage' is not set."));
        exportImportService.importProject(dst.id(), archive, importCtx(dst), ImportOptions.DEFAULT);

        assertThat(startPageOf(dst, dst.pagesRoot())).isEqualTo(landing);
        assertThat(startPageOf(dst, src.products())).as("other folders carry theirs").isEqualTo(src.overview());
    }

    @Test
    @DisplayName("a protocol-10 archive imports unchanged: the site root gets no start page and nothing is reported")
    void protocol10ArchiveImportsUnchanged() throws Exception {
        Source src = source("sp10");
        byte[] archive = exportImportService.exportProject(src.fx().id());
        byte[] protocol10 = rewrite(archive, (name, text) -> name.equals("manifest.json")
                ? text.replaceAll("\"protocolVersion\":\\d+", "\"protocolVersion\":10")
                : text);

        Fixture dst = fixture("sp10d");
        ConflictReport analysis = exportImportService.analyzeImport(dst.id(), protocol10, ImportOptions.DEFAULT);
        assertThat(analysis.blocksImport()).isFalse();
        assertThat(analysis.conflicts()).extracting(ImportConflict::type).doesNotContain(ConflictType.START_PAGE_NOT_MERGED);
        exportImportService.importProject(dst.id(), protocol10, importCtx(dst), ImportOptions.DEFAULT);

        assertThat(startPageOf(dst, dst.pagesRoot())).isNull();
        assertThat(assets.requireCurrent(dst.id(), src.hammer()).displayName()).isEqualTo("Hammer");
    }

    // ------------------------------------------------------------------

    private Source source(String prefix) {
        Fixture fx = fixture(prefix);
        UUID homepage = pages.create(new CreatePageCommand("Homepage", null, fx.template().uuid()), fx.ctx()).uuid();
        pages.create(new CreatePageCommand("About", null, fx.template().uuid()), fx.ctx());
        UUID products = folders.create(null, "Products", FolderScope.PAGES, fx.ctx()).uuid();
        UUID overview = pages.create(new CreatePageCommand("Overview", products, fx.template().uuid()), fx.ctx()).uuid();
        UUID hammer = pages.create(new CreatePageCommand("Hammer", products, fx.template().uuid()), fx.ctx()).uuid();
        setStartPage(fx, fx.pagesRoot(), homepage);
        setStartPage(fx, products, overview);
        return new Source(fx, homepage, products, overview, hammer);
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        String key = prefix + n + "x" + (System.nanoTime() % 100_000);
        AppUser admin = users.create(key, key + "@example.com", "Admin", "secret-password");
        Project project = projects.create(new CreateProjectRequest(key, key, null, "start page export"), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "start page export");
        TemplateView template = templates.create(new CreateTemplateCommand(project.getId(), AssetType.PAGE_TEMPLATE, "Page",
                CDL, Map.of("html", "<h1>$CMS_VALUE(title)$</h1>"), null, false, Map.of()), ctx);
        UUID pagesRoot = assets.ensurePagesRootFolder(project.getId(), ctx).uuid();
        return new Fixture(project, admin, ctx, template, pagesRoot);
    }

    private void setStartPage(Fixture fx, UUID folder, UUID page) {
        folders.updateStartPage(folder, page, assets.requireCurrent(fx.id(), folder).validFromRevision(), fx.ctx());
    }

    /** The start page the folder's current payload names in the project. */
    private UUID startPageOf(Fixture fx, UUID folder) {
        return StartPage.fromPayload(assets.requireCurrent(fx.id(), folder).payload());
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
            throw new AssertionError("No archive entry " + name + " in " + List.copyOf(entries(archive).keySet()));
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
