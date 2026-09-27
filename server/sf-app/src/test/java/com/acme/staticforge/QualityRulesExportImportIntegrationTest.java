package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.exportimport.ConflictReport;
import com.acme.staticforge.exportimport.ConflictType;
import com.acme.staticforge.exportimport.ImportConflict;
import com.acme.staticforge.exportimport.ImportOptions;
import com.acme.staticforge.exportimport.ProjectExportImportService;
import com.acme.staticforge.generate.quality.QualityRuleConfig;
import com.acme.staticforge.generate.quality.QualityRuleConfigService;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/**
 * The quality rule configuration travels with the project settings in a full-project archive (M30.1.2): a round
 * trip keeps it, unknown codes are dropped with a warning, a target's own configuration is never overwritten, and a
 * protocol-9 archive imports without one.
 */
@SpringBootTest
@ActiveProfiles("test")
@Import(QualityTestRules.class)
class QualityRulesExportImportIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService users;
    @Autowired ProjectService projects;
    @Autowired ProjectExportImportService exportImport;
    @Autowired QualityRuleConfigService configService;
    @Autowired ObjectMapper mapper;

    private record Fixture(Project project, RevisionContext ctx) {
        long id() {
            return project.getId();
        }
    }

    private Fixture fixture(String prefix) {
        int n = SEQ.incrementAndGet();
        AppUser user = users.create(prefix + n, prefix + n + "@example.com", "User", "secret-password");
        Project project = projects.create(new CreateProjectRequest(prefix + n, prefix + n, null, "quality export"), user.getId());
        return new Fixture(project, RevisionContext.of(project.getId(), user.getId(), "quality export"));
    }

    private void configure(Fixture fx) {
        configService.update(fx.project().getKey(), Map.of(
                QualityTestRules.FLAG, new QualityRuleConfig.Entry("ERROR", Map.of("limit", 3)),
                QualityTestRules.MISSING, new QualityRuleConfig.Entry("OFF", null)), fx.ctx());
    }

    @Test
    void aRoundTripKeepsTheConfiguration() throws IOException {
        Fixture source = fixture("qxsrc");
        configure(source);
        byte[] archive = exportImport.exportProject(source.id());
        assertThat(entry(archive, "settings.json")).contains("\"qualityRules\"").contains(QualityTestRules.FLAG);

        Fixture target = fixture("qxdst");
        ConflictReport analysis = exportImport.analyzeImport(target.id(), archive, ImportOptions.DEFAULT);
        assertThat(analysis.conflicts()).extracting(ImportConflict::type).doesNotContain(ConflictType.UNKNOWN_QUALITY_RULE);
        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(projects.requireByKey(target.project().getKey()).getQualityRuleConfig())
                .isEqualTo(projects.requireByKey(source.project().getKey()).getQualityRuleConfig());
        assertThat(configService.effective(target.id()).severity(QualityTestRules.FLAG)).isEqualTo(QualitySeverity.ERROR);
    }

    @Test
    void unknownCodesAreDroppedWithAWarning() throws IOException {
        Fixture source = fixture("qxunk");
        configure(source);
        byte[] archive = rewrite(exportImport.exportProject(source.id()), (name, text) -> name.equals("settings.json")
                ? text.replace("\"rules\":{", "\"rules\":{\"SF-CHK-0999\":{\"severity\":\"ERROR\"},")
                : text);

        Fixture target = fixture("qxunkdst");
        ConflictReport analysis = exportImport.analyzeImport(target.id(), archive, ImportOptions.DEFAULT);
        assertThat(analysis.conflicts()).filteredOn(c -> c.type() == ConflictType.UNKNOWN_QUALITY_RULE)
                .singleElement()
                .satisfies(conflict -> {
                    assertThat(conflict.blocksImport()).isFalse();
                    assertThat(conflict.detail()).contains("SF-CHK-0999");
                });
        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        var stored = projects.requireByKey(target.project().getKey()).getQualityRuleConfig();
        assertThat(stored.path("rules").has("SF-CHK-0999")).isFalse();
        assertThat(stored.path("rules").has(QualityTestRules.FLAG)).isTrue();
    }

    @Test
    void aTargetsOwnConfigurationIsKept() throws IOException {
        Fixture source = fixture("qxkeep");
        configure(source);
        byte[] archive = exportImport.exportProject(source.id());
        Fixture target = fixture("qxkeepdst");
        configService.update(target.project().getKey(), Map.of(
                QualityTestRules.FLAG, new QualityRuleConfig.Entry("OFF", null)), target.ctx());

        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(configService.effective(target.id()).severity(QualityTestRules.FLAG)).isEqualTo(QualitySeverity.OFF);
    }

    @Test
    void aProtocol9ArchiveImportsWithoutAConfiguration() throws IOException {
        Fixture source = fixture("qxold");
        configure(source);
        byte[] archive = rewrite(exportImport.exportProject(source.id()), (name, text) -> name.equals("manifest.json")
                ? text.replaceAll("\"protocolVersion\":\\d+", "\"protocolVersion\":9")
                : text);

        Fixture target = fixture("qxolddst");
        exportImport.importProject(target.id(), archive, target.ctx(), ImportOptions.DEFAULT);

        assertThat(projects.requireByKey(target.project().getKey()).getQualityRuleConfig()).isNull();
    }

    // ------------------------------------------------------------------

    private static Map<String, byte[]> entries(byte[] archive) throws IOException {
        Map<String, byte[]> out = new LinkedHashMap<>();
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
