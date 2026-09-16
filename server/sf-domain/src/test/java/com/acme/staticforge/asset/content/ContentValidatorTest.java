package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.content.SelectOption;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** {@link ContentValidator} rules (spec §10.5, §14.4). */
class ContentValidatorTest {

    private final ContentValidator validator = new ContentValidator();

    @Test
    void requiredEmptyIsError() {
        ContentDefinition def = definition(editor("headline", EditorType.TEXT, true));
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("{\"headline\":\"\"}"));
        assertThat(issues)
                .anyMatch(i -> i.code().equals("required")
                        && i.path().equals("headline")
                        && i.severity() == Severity.ERROR);
    }

    @Test
    void maxLengthExceededIsError() {
        ContentDefinition def = definition(editor("title", EditorType.TEXT, null, null, 5, null, null, null, false));
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("{\"title\":\"too long\"}"));
        assertThat(issues).anyMatch(i -> i.code().equals("maxLength") && i.severity() == Severity.ERROR);
    }

    @Test
    void patternMismatchIsError() {
        ContentDefinition def = definition(editor("slug", EditorType.TEXT, null, null, null, null, "^[a-z0-9-]+$", "Lowercase only", false));
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("{\"slug\":\"Hello World\"}"));
        assertThat(issues).anyMatch(i -> i.code().equals("pattern") && i.severity() == Severity.ERROR);
    }

    @Test
    void selectValueOutsideOptionsIsError() {
        ContentDefinition def = definition(editor("layout", EditorType.SELECT, List.of(
                new SelectOption("left", "Left"), new SelectOption("right", "Right")), false));
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("{\"layout\":\"full\"}"));
        assertThat(issues).anyMatch(i -> i.code().equals("option") && i.severity() == Severity.ERROR);
    }

    @Test
    void fullyValidContentHasNoIssues() {
        ContentDefinition def = new ContentDefinition(
                List.of(
                        editor("headline", EditorType.TEXT, true),
                        editor("age", EditorType.NUMBER, 0, 120, null, null, null, null, false),
                        editor("layout", EditorType.SELECT, List.of(
                                new SelectOption("left", "Left"), new SelectOption("right", "Right")), false)),
                List.of());
        List<ContentIssue> issues = validator.validate(
                def, JsonUtil.parse("{\"headline\":\"Hello\",\"age\":42,\"layout\":\"left\"}"));
        assertThat(issues).isEmpty();
    }

    @Test
    void hiddenByVisibleWhenSkipsRequired() {
        ContentDefinition def = definition(editor("cta", EditorType.TEXT, null, null, null, null, null, null, "showCta == true", true));
        List<ContentIssue> issues = validator.validate(
                def, JsonUtil.parse("{\"showCta\":false}"));
        assertThat(issues).noneMatch(i -> i.path().equals("cta"));
    }

    @Test
    void visibleFieldStillValidated() {
        ContentDefinition def = definition(editor("cta", EditorType.TEXT, null, null, null, null, null, null, "showCta == true", true));
        List<ContentIssue> issues = validator.validate(
                def, JsonUtil.parse("{\"showCta\":true}"));
        assertThat(issues).anyMatch(i -> i.path().equals("cta") && i.code().equals("required"));
    }

    @Test
    void unknownKeysAreIgnored() {
        ContentDefinition def = definition(editor("headline", EditorType.TEXT, false));
        List<ContentIssue> issues = validator.validate(
                def, JsonUtil.parse("{\"headline\":\"x\",\"extra\":{\"a\":1}}"));
        assertThat(issues).isEmpty();
    }

    @Test
    void numberBelowMinIsError() {
        ContentDefinition def = definition(editor("age", EditorType.NUMBER, 18, null, null, null, null, null, false));
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("{\"age\":3}"));
        assertThat(issues).anyMatch(i -> i.code().equals("min"));
    }

    @Test
    void malformedShapeIsError() {
        ContentDefinition def = definition(editor("age", EditorType.NUMBER, false));
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("{\"age\":\"forty\"}"));
        assertThat(issues).anyMatch(i -> i.code().equals("type"));
    }

    @Test
    void issueKindSeparatesStructuralFromCompleteness() {
        assertThat(new ContentIssue("a", "type", Severity.ERROR, "m").kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
        assertThat(new ContentIssue("a", "option", Severity.ERROR, "m").kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
        assertThat(new ContentIssue("a", "allow", Severity.ERROR, "m").kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
        assertThat(new ContentIssue("a", "template", Severity.ERROR, "m").kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
        for (String code : List.of("required", "min", "max", "maxLength", "maxChars", "pattern", "mimeType", "visibleWhen")) {
            assertThat(new ContentIssue("a", code, Severity.ERROR, "m").kind()).isEqualTo(ContentIssue.Kind.COMPLETENESS);
        }
    }

    @Test
    void listItemThatIsNotAnObjectIsStructural() {
        ContentDefinition def = cdl("content { editor list links { item { editor text label { } } } }");
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("{\"links\":[{\"label\":\"ok\"},\"oops\"]}"));
        assertThat(issues).singleElement().satisfies(i -> {
            assertThat(i.path()).isEqualTo("links[1]");
            assertThat(i.kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
        });
    }

    @Test
    void untouchedObjectEditorPlaceholdersAreEmptyNotMalformed() {
        ContentDefinition def = cdl("""
                content {
                  editor media hero { required }
                  editor reference related { required }
                  editor link target { required }
                  editor richtext body { required }
                }
                """);
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("""
                {"hero":{"type":"MEDIA_REF","uuid":null,"variant":null,"altOverride":null},
                 "related":{"type":"ASSET_REF","uuid":null,"assetType":null},
                 "target":{"kind":"INTERNAL","uuid":null,"url":null,"anchor":null,"target":null,"title":null},
                 "body":{"format":"html","value":""}}
                """));
        assertThat(issues).extracting(ContentIssue::path).containsExactlyInAnyOrder("hero", "related", "target", "body");
        assertThat(issues).allMatch(i -> i.code().equals("required") && i.kind() == ContentIssue.Kind.COMPLETENESS);
    }

    @Test
    void malformedRefAndLinkShapesAreStructural() {
        ContentDefinition def = cdl("""
                content {
                  editor media hero { }
                  editor reference related { }
                  editor link target { }
                }
                """);
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("""
                {"hero":{"type":"MEDIA_REF","uuid":"not-a-uuid"},
                 "related":{"type":"MEDIA_REF","uuid":"6f1c7c1e-2f4e-4a57-9d59-6c1f0f7f0c11"},
                 "target":{"kind":"FTP","url":"ftp://example.com"}}
                """));
        assertThat(issues).extracting(ContentIssue::path).containsExactlyInAnyOrder("hero", "related", "target");
        assertThat(issues).allMatch(i -> i.code().equals("type") && i.kind() == ContentIssue.Kind.STRUCTURAL);
    }

    @Test
    void wellFormedRefsAndLinksHaveNoIssues() {
        ContentDefinition def = cdl("content { editor media hero { } editor reference related { } editor link target { } }");
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("""
                {"hero":{"type":"MEDIA_REF","uuid":"6f1c7c1e-2f4e-4a57-9d59-6c1f0f7f0c11","variant":null},
                 "related":{"type":"ASSET_REF","uuid":"6f1c7c1e-2f4e-4a57-9d59-6c1f0f7f0c11","assetType":"PAGE"},
                 "target":{"kind":"EXTERNAL","uuid":null,"url":"https://example.com","title":"Example"}}
                """));
        assertThat(issues).isEmpty();
    }

    @Test
    void catalogCardsAreCheckedAgainstAllowAndTheirOwnTemplateWhenSectionsResolve() {
        ContentDefinition def = cdl("content { editor catalog related { allow [\"teaser\"] } }");
        SectionTemplateLookup sections = ref -> switch (ref) {
            case "t-teaser" -> Optional.of(new SectionTemplateLookup.SectionTemplate(
                    "teaser", cdl("content { editor number count { required } }")));
            case "t-banner" -> Optional.of(new SectionTemplateLookup.SectionTemplate("banner", cdl("content { }")));
            default -> Optional.empty();
        };
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse("""
                {"related":{"type":"CATALOG","cards":[
                  {"instanceId":"c1","templateRef":"t-teaser","content":{"count":"abc"}},
                  {"instanceId":"c2","templateRef":"t-banner","content":{}},
                  {"instanceId":"c3","templateRef":"t-gone","content":{}},
                  {"instanceId":"c4","templateRef":"t-teaser","content":{}}
                ]}}
                """), sections, "content");
        assertThat(issues).extracting(ContentIssue::path, ContentIssue::code).containsExactly(
                org.assertj.core.groups.Tuple.tuple("content.related.cards[0].content.count", "type"),
                org.assertj.core.groups.Tuple.tuple("content.related.cards[1].templateRef", "allow"),
                org.assertj.core.groups.Tuple.tuple("content.related.cards[2].templateRef", "template"),
                org.assertj.core.groups.Tuple.tuple("content.related.cards[3].content.count", "required"));
    }

    @Test
    void catalogCardsAreOnlyShapeCheckedWithoutSectionLookup() {
        ContentDefinition def = cdl("content { editor catalog related { allow [\"teaser\"] } }");
        List<ContentIssue> issues = validator.validate(def, JsonUtil.parse(
                "{\"related\":{\"type\":\"CATALOG\",\"cards\":[{\"instanceId\":\"c1\",\"templateRef\":\"t-x\"}]}}"));
        assertThat(issues).isEmpty();
    }

    private static ContentDefinition cdl(String source) {
        CdlResult result = new CdlCompiler().compile(source);
        assertThat(result.diagnostics()).as("CDL diagnostics").noneMatch(d -> d.severity() == Severity.ERROR);
        return result.definition();
    }

    private static ContentDefinition definition(EditorDefinition editor) {
        return new ContentDefinition(List.of(editor), List.of());
    }

    private static EditorDefinition editor(String name, EditorType type, boolean required) {
        return editor(name, type, null, null, null, null, null, null, null, required);
    }

    private static EditorDefinition editor(String name, EditorType type, List<SelectOption> options, boolean required) {
        return new EditorDefinition(
                name, type, name, null, required, false, false, null, null, null, null, null, null, null,
                List.of(), List.of(), options, List.of(), List.of(), null, null, List.of(), null);
    }

    private static EditorDefinition editor(
            String name,
            EditorType type,
            Integer min,
            Integer max,
            Integer maxLength,
            Integer maxChars,
            String pattern,
            String patternMessage,
            boolean required) {
        return editor(name, type, min, max, maxLength, maxChars, pattern, patternMessage, null, required);
    }

    private static EditorDefinition editor(
            String name,
            EditorType type,
            Integer min,
            Integer max,
            Integer maxLength,
            Integer maxChars,
            String pattern,
            String patternMessage,
            String visibleWhen,
            boolean required) {
        return new EditorDefinition(
                name, type, name, null, required, false, false, null, min, max, maxLength, maxChars,
                pattern, patternMessage, List.of(), List.of(), List.of(), List.of(), List.of(), visibleWhen, null, List.of(), null);
    }
}
