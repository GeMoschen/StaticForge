package com.acme.staticforge.template.render;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import com.acme.staticforge.template.cdl.GlobalSetCdlRules;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * {@code M17.5.1}: the worked example in {@code docs/template-developer-guide.md} §2.7, verbatim.
 *
 * <p>The task asks that every snippet in the docs be checked against a real render so the docs
 * cannot drift from behaviour. If you change the example there, change it here — the strings below
 * are copied character for character, and this test is the only thing keeping them honest.
 */
class GlobalsDocsExampleTest {

    private static final String SITE_CDL =
            """
            content {
              editor text    title      { label "Site title" required }
              editor media   logo       { label "Logo" }
              editor boolean showBanner { label "Show banner" }
            }
            """;

    private static final String SOCIAL_CDL =
            """
            content {
              editor list links {
                label "Social links"
                item {
                  editor text label  { label "Label" required }
                  editor link target { label "Target" }
                }
              }
            }
            """;

    private static final String HEADER =
            """
            <header>
              <a href="index.html"><img src="$CMS_REF(CMS_GLOBAL.site.logo)$" alt="$CMS_VALUE(CMS_GLOBAL.site.title)$"></a>
              <h1>$CMS_VALUE(CMS_GLOBAL.site.title)$</h1>
              $CMS_IF(CMS_GLOBAL.site.showBanner)$<aside class="banner">$CMS_VALUE(CMS_GLOBAL.site.title | upper)$</aside>$CMS_END_IF$
              <ul>$CMS_FOR(link : CMS_GLOBAL.social.links)$<li>$CMS_VALUE(link.label)$</li>$CMS_END_FOR$</ul>
            </header>
            """;

    private static final UUID SITE = UUID.fromString("c0000000-0000-0000-0000-000000000001");
    private static final UUID SOCIAL = UUID.fromString("c0000000-0000-0000-0000-000000000002");
    private static final UUID LOGO = UUID.fromString("c0000000-0000-0000-0000-00000000000a");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void bothDocumentedSetSchemasAreValidPropertySetCdl() {
        for (String cdl : new String[] {SITE_CDL, SOCIAL_CDL}) {
            CdlResult result = new CdlCompiler().compile(cdl);
            assertThat(result.hasErrors()).withFailMessage("%s", result.diagnostics()).isFalse();
            assertThat(GlobalSetCdlRules.check(result.definition())).isEmpty();
        }
    }

    @Test
    void theDocumentedHeaderRendersTheSetValues() throws Exception {
        Map<String, UUID> refs = Map.of("global:site", SITE, "global:social", SOCIAL);
        OctlResult compiled = new OctlCompiler()
                .compile(HEADER, "html", (type, uid) -> Optional.ofNullable(refs.get(type + ":" + uid)));
        assertThat(compiled.hasErrors()).withFailMessage("%s", compiled.diagnostics()).isFalse();

        JsonNode site = MAPPER.readTree("{\"title\":\"Acme Outdoor\",\"showBanner\":true,"
                + "\"logo\":{\"type\":\"MEDIA_REF\",\"uuid\":\"" + LOGO + "\"}}");
        JsonNode social = MAPPER.readTree("{\"links\":[{\"label\":\"Mastodon\"},{\"label\":\"Bluesky\"}]}");

        RenderResult result = new OctlRenderer().render(
                compiled.template(),
                RenderContext.builder()
                        .assetValueResolver((type, uuid) -> SITE.equals(uuid)
                                ? site
                                : SOCIAL.equals(uuid) ? social : MissingNode.getInstance())
                        .urlResolver((kind, uid, uuid, args) -> "media".equals(kind) ? "media/logo.png" : "")
                        .build());

        assertThat(result.output())
                .contains("<img src=\"media/logo.png\" alt=\"Acme Outdoor\">")
                .contains("<h1>Acme Outdoor</h1>")
                .contains("<aside class=\"banner\">ACME OUTDOOR</aside>")
                .contains("<ul><li>Mastodon</li><li>Bluesky</li></ul>");
        assertThat(result.dependencies()).contains(SITE, SOCIAL, LOGO);
    }
}
