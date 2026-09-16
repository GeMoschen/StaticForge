package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.content.ContentRenameMigrator.EditorRename;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The {@code renamedFrom} migration step (spec §12.3) that the section-template cascade and a
 * global property set's own values now share.
 */
class ContentRenameMigratorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final CdlCompiler compiler = new CdlCompiler();

    @Test
    void collectsDeclaredRenamesAndIgnoresNoOpOnes() {
        ContentDefinition definition = compile("""
                content {
                  editor text siteTitle { label "Site title" renamedFrom "title" }
                  editor text tagline { label "Tagline" renamedFrom "tagline" }
                  editor text untouched { label "Untouched" }
                }
                """);

        assertThat(ContentRenameMigrator.collect(definition))
                .containsExactly(new EditorRename("title", "siteTitle"));
    }

    /** Groups are transparent — their children live in the enclosing namespace, so they migrate too. */
    @Test
    void walksThroughTransparentGroups() {
        ContentDefinition definition = compile("""
                content {
                  group "Branding" {
                    editor text siteTitle { label "Site title" renamedFrom "title" }
                  }
                }
                """);

        assertThat(ContentRenameMigrator.collect(definition))
                .containsExactly(new EditorRename("title", "siteTitle"));
    }

    @Test
    void movesTheValueToTheNewKey() {
        ObjectNode content = json("{\"title\":\"Acme Outdoor\",\"other\":1}");

        assertThat(ContentRenameMigrator.apply(content, List.of(new EditorRename("title", "siteTitle")))).isTrue();
        assertThat(content.path("siteTitle").asText()).isEqualTo("Acme Outdoor");
        assertThat(content.has("title")).isFalse();
        assertThat(content.path("other").asInt()).isEqualTo(1);
    }

    @Test
    void applyingTheSameMigrationTwiceIsHarmless() {
        ObjectNode content = json("{\"title\":\"Acme Outdoor\"}");
        List<EditorRename> renames = List.of(new EditorRename("title", "siteTitle"));

        ContentRenameMigrator.apply(content, renames);
        assertThat(ContentRenameMigrator.apply(content, renames)).isFalse();
        assertThat(content.path("siteTitle").asText()).isEqualTo("Acme Outdoor");
    }

    @Test
    void pruningDropsValuesWhoseEditorIsGoneAndKeepsDeclaredOnes() {
        ContentDefinition definition = compile("""
                content {
                  editor text title { label "Site title" }
                  group "Branding" { editor media logo { label "Logo" } }
                }
                """);
        ObjectNode content = json("{\"title\":\"Acme\",\"logo\":{\"type\":\"MEDIA_REF\"},\"removed\":\"x\"}");

        assertThat(ContentRenameMigrator.pruneUnknown(content, definition)).isTrue();
        assertThat(content.fieldNames()).toIterable().containsExactlyInAnyOrder("title", "logo");
    }

    /** Pruning runs after the rename, so a renamed editor's value survives instead of vanishing. */
    @Test
    void renameThenPruneKeepsTheMigratedValue() {
        ContentDefinition definition = compile("""
                content { editor text siteTitle { label "Site title" renamedFrom "title" } }
                """);
        ObjectNode content = json("{\"title\":\"Acme Outdoor\"}");

        ContentRenameMigrator.apply(content, ContentRenameMigrator.collect(definition));
        ContentRenameMigrator.pruneUnknown(content, definition);

        assertThat(content.path("siteTitle").asText()).isEqualTo("Acme Outdoor");
    }

    private ContentDefinition compile(String cdl) {
        var result = compiler.compile(cdl);
        assertThat(result.hasErrors()).withFailMessage("CDL did not compile: %s", result.diagnostics()).isFalse();
        return result.definition();
    }

    private static ObjectNode json(String text) {
        try {
            return (ObjectNode) MAPPER.readTree(text);
        } catch (Exception e) {
            throw new AssertionError("bad test json", e);
        }
    }
}
