package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.diagnostic.DiagnosticCodes;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * Keeps the template developer guide honest (M19.5.1): every fenced code block preceded by
 * {@code <!-- golden: <dir>/<file> -->} must equal that golden file under {@code src/test/resources},
 * so a worked example in the docs can't drift from what the renderer actually produces.
 */
class DocsGoldenSnippetsTest {

    private static final Path GUIDE = Path.of("../../docs/template-developer-guide.md");
    private static final Path RESOURCES = Path.of("src/test/resources");
    private static final Pattern SNIPPET =
            Pattern.compile("<!-- golden: (\\S+) -->\\n```[a-z]*\\n(.*?)```", Pattern.DOTALL);

    @Test
    void guideSnippetsMatchGoldenFiles() throws Exception {
        String guide = normalize(Files.readString(GUIDE));
        Matcher matcher = SNIPPET.matcher(guide);
        List<String> checked = new ArrayList<>();
        while (matcher.find()) {
            Path golden = RESOURCES.resolve(matcher.group(1));
            assertThat(golden).as("golden file referenced by the guide").exists();
            assertThat(matcher.group(2))
                    .as("guide snippet for %s", matcher.group(1))
                    .isEqualTo(normalize(Files.readString(golden)).stripTrailing() + "\n");
            checked.add(matcher.group(1));
        }
        assertThat(checked).as("pinned snippets found in the guide").hasSizeGreaterThanOrEqualTo(7);
    }

    /** Every code in {@link DiagnosticCodes} has a row in the guide's catalogue (M20.5.1). */
    @Test
    void everyDiagnosticCodeIsCatalogued() throws Exception {
        String guide = Files.readString(GUIDE);
        List<String> missing = new ArrayList<>();
        for (Field field : DiagnosticCodes.class.getFields()) {
            if (Modifier.isStatic(field.getModifiers()) && field.getType() == String.class) {
                String code = (String) field.get(null);
                if (!guide.contains("| `" + code + "` |")) {
                    missing.add(field.getName() + " = " + code);
                }
            }
        }
        assertThat(missing).as("DiagnosticCodes without a catalogue row in the developer guide").isEmpty();
    }

    private static String normalize(String text) {
        return text.replace("\r\n", "\n");
    }
}
