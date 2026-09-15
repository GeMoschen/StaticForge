package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** {@link PageContentValidator}: page content, body allow lists/cardinality and section content (spec §10.5, §14.6). */
class PageContentValidatorTest {

    private static final ContentDefinition PAGE = cdl("""
            content { editor text title { required } }
            bodies {
              body main    { allow ["*"] }
              body sidebar { allow ["teaser"] min 1 }
            }
            """);

    private static final Map<String, SectionTemplateLookup.SectionTemplate> TEMPLATES = Map.of(
            "t-teaser", new SectionTemplateLookup.SectionTemplate("teaser", cdl("""
                    content {
                      editor text headline { required }
                      editor catalog cards { }
                    }
                    """)),
            "t-banner", new SectionTemplateLookup.SectionTemplate("banner", cdl("content { editor number height { } }")));

    private static final SectionTemplateLookup SECTIONS = ref -> Optional.ofNullable(TEMPLATES.get(ref));

    private final PageContentValidator validator = new PageContentValidator();

    @Test
    void wholePageReportsContentBodiesAndSectionsWithPayloadRootedPaths() {
        JsonNode payload = JsonUtil.parse("""
                {"content":{"title":""},
                 "bodies":{
                   "main":[{"instanceId":"s1","templateRef":"t-banner","content":{"height":"tall"}}],
                   "sidebar":[]
                 }}
                """);

        List<ContentIssue> issues = validator.validatePage(PAGE, payload, SECTIONS);

        assertThat(issues).extracting(ContentIssue::path, ContentIssue::code, ContentIssue::kind).containsExactlyInAnyOrder(
                tuple("content.title", "required", ContentIssue.Kind.COMPLETENESS),
                tuple("bodies.main[0].content.height", "type", ContentIssue.Kind.STRUCTURAL),
                tuple("bodies.sidebar", "min", ContentIssue.Kind.COMPLETENESS));
    }

    @Test
    void declaredBodyMissingFromThePayloadStillReportsItsMinimum() {
        List<ContentIssue> issues = validator.validatePage(PAGE, JsonUtil.parse("{\"content\":{\"title\":\"Hi\"}}"), SECTIONS);

        assertThat(issues).extracting(ContentIssue::path, ContentIssue::code).containsExactly(tuple("bodies.sidebar", "min"));
    }

    @Test
    void sectionOutsideTheBodyAllowListIsStructural() {
        JsonNode payload = JsonUtil.parse("""
                {"bodies":{"sidebar":[{"instanceId":"s1","templateRef":"t-banner","content":{}}]}}
                """);

        List<ContentIssue> issues = validator.validateSection(PAGE, "sidebar", "s1", payload, SECTIONS);

        assertThat(issues).singleElement().satisfies(issue -> {
            assertThat(issue.path()).isEqualTo("bodies.sidebar[0].templateRef");
            assertThat(issue.code()).isEqualTo("allow");
            assertThat(issue.kind()).isEqualTo(ContentIssue.Kind.STRUCTURAL);
        });
    }

    @Test
    void sectionInAnUndeclaredBodyHasNoAllowListButItsContentIsValidated() {
        JsonNode payload = JsonUtil.parse("""
                {"bodies":{"legacy":[{"instanceId":"s1","templateRef":"t-banner","content":{"height":"x"}}]}}
                """);

        List<ContentIssue> issues = validator.validateSection(PAGE, "legacy", "s1", payload, SECTIONS);

        assertThat(issues).extracting(ContentIssue::path).containsExactly("bodies.legacy[0].content.height");
    }

    @Test
    void catalogCardNestedTwoLevelsDeepReportsTheFullPath() {
        JsonNode payload = JsonUtil.parse("""
                {"bodies":{"main":[{"instanceId":"s1","templateRef":"t-teaser","content":{
                  "headline":"Outer",
                  "cards":{"type":"CATALOG","cards":[{"instanceId":"c1","templateRef":"t-teaser","content":{
                    "headline":"Inner",
                    "cards":{"type":"CATALOG","cards":[{"instanceId":"c2","templateRef":"t-banner","content":{"height":[1]}}]}
                  }}]}
                }}]}}
                """);

        List<ContentIssue> issues = validator.validateBody(PAGE, "main", payload, SECTIONS);

        assertThat(issues).extracting(ContentIssue::path, ContentIssue::code).containsExactly(
                tuple("bodies.main[0].content.cards.cards[0].content.cards.cards[0].content.height", "type"));
    }

    @Test
    void contentOnlyValidationIgnoresSections() {
        JsonNode payload = JsonUtil.parse("""
                {"content":{"title":"Hi"},
                 "bodies":{"main":[{"instanceId":"s1","templateRef":"t-banner","content":{"height":"tall"}}]}}
                """);

        assertThat(validator.validateContent(PAGE, payload, SECTIONS)).isEmpty();
    }

    private static ContentDefinition cdl(String source) {
        return new CdlCompiler().compile(source).definition();
    }
}
