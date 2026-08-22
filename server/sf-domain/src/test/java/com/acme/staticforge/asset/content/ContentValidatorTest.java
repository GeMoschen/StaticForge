package com.acme.staticforge.asset.content;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.JsonUtil;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.content.EditorType;
import com.acme.staticforge.template.content.SelectOption;
import com.acme.staticforge.template.diagnostic.Severity;
import java.util.List;
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

    private static ContentDefinition definition(EditorDefinition editor) {
        return new ContentDefinition(List.of(editor), List.of());
    }

    private static EditorDefinition editor(String name, EditorType type, boolean required) {
        return editor(name, type, null, null, null, null, null, null, null, required);
    }

    private static EditorDefinition editor(String name, EditorType type, List<SelectOption> options, boolean required) {
        return new EditorDefinition(
                name, type, name, null, required, false, false, null, null, null, null, null, null, null,
                List.of(), List.of(), options, List.of(), null, null, List.of());
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
                pattern, patternMessage, List.of(), List.of(), List.of(), List.of(), visibleWhen, null, List.of());
    }
}
