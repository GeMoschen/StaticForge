package com.acme.staticforge.search.extract;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.search.SearchDocument;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.content.ContentDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Every extractor on representative payloads (M23.1.2). */
class SearchTextExtractorsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final CdlCompiler CDL = new CdlCompiler();

    private final UUID pageTemplate = UUID.randomUUID();
    private final UUID teaser = UUID.randomUUID();
    private final UUID dataset = UUID.randomUUID();
    private final FakeContext context = new FakeContext();

    private final SearchTextExtractorRegistry registry = new SearchTextExtractorRegistry(List.of(
            new PageTextExtractor(),
            new MediaTextExtractor(),
            new TemplateTextExtractor(),
            new PageReferenceTextExtractor(),
            new FolderTextExtractor(),
            new ContentHolderTextExtractor(),
            new RecordSetTextExtractor()));

    private static JsonNode json(String source) {
        try {
            return JSON.readTree(source.replace('\'', '"'));
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    /** Compiles editor declarations, wrapped in the {@code content} block unless the source already has one. */
    private static ContentDefinition cdl(String source) {
        String wrapped = source.strip().startsWith("content") ? source : "content {\n" + source + "\n}";
        return CDL.compile(wrapped).definition();
    }

    private Optional<SearchDocument> extract(AssetType type, String uid, String displayName, JsonNode payload) {
        return registry.extract(
                new IndexableAsset(UUID.randomUUID(), type, uid, displayName, "/pages_root/", null, 5, payload), context);
    }

    private SearchDocument page(String payload) {
        return extract(AssetType.PAGE, "home", "Home page", json(payload)).orElseThrow();
    }

    @Test
    void richTextIsPlainText() {
        context.pages.put(pageTemplate, cdl("editor richtext body { label 'Body' }".replace('\'', '"')));

        SearchDocument doc = page("{'templateRef':'" + pageTemplate + "','content':{'body':"
                + "{'format':'html','value':'<p>Hello <strong>world</strong></p>'}}}");

        assertThat(doc.text()).isEqualTo("Hello world");
        assertThat(doc.title()).isEqualTo("Home page home");
        assertThat(doc.source()).isEmpty();
    }

    @Test
    void nestedListInsideACatalogCardIsExtracted() {
        context.pages.put(pageTemplate, cdl("editor catalog related { label \"Related\" }"));
        context.sections.put(teaser, cdl("""
                editor text headline { label "Headline" }
                editor list bullets {
                  label "Bullets"
                  item {
                    editor text line { label "Line" }
                    editor link target { label "Target" }
                  }
                }
                """));

        SearchDocument doc = page("{'templateRef':'" + pageTemplate + "','content':{'related':{'type':'CATALOG','cards':["
                + "{'instanceId':'c1','templateRef':'" + teaser + "','content':{'headline':'Card title',"
                + "'bullets':[{'line':'inner bullet','target':{'kind':'EXTERNAL','url':'https://x','title':'Link title'}}]}}"
                + "]}}}");

        assertThat(doc.text()).contains("Card title", "inner bullet", "Link title").doesNotContain("https://x", "c1");
    }

    @Test
    void sectionContentAndMetaAreIncluded() {
        context.pages.put(pageTemplate, cdl("editor text intro { label \"Intro\" }"));
        context.sections.put(teaser, cdl("editor textarea blurb { label \"Blurb\" }"));

        SearchDocument doc = page("{'templateRef':'" + pageTemplate + "','content':{'intro':'Page intro'},"
                + "'bodies':{'main':[{'instanceId':'s1','templateRef':'" + teaser + "','content':{'blurb':'Section blurb'}}]},"
                + "'meta':{'title':'SEO title','description':'SEO description'}}");

        assertThat(doc.text()).contains("Page intro", "Section blurb", "SEO title", "SEO description");
    }

    @Test
    void referencesMediaJsonAndOtherNonTextValuesAreSkipped() {
        context.pages.put(pageTemplate, cdl("""
                editor reference ref { label "Ref" }
                editor media image { label "Image" }
                editor json data { label "Data" }
                editor number count { label "Count" }
                editor select layout { label "Layout" options [ { value "left", label "Image left" } ] }
                group "SEO" { editor text keywords { label "Keywords" } }
                """));

        SearchDocument doc = page("{'templateRef':'" + pageTemplate + "','content':{"
                + "'ref':{'type':'ASSET_REF','uuid':'" + UUID.randomUUID() + "','displayName':'Secret ref name'},"
                + "'image':{'type':'MEDIA_REF','uuid':'" + UUID.randomUUID() + "','altText':'Secret alt'},"
                + "'data':{'hidden':'json value'},'count':42,'layout':'left','keywords':'grouped words'}}");

        assertThat(doc.text())
                .contains("Image left", "grouped words")
                .doesNotContain("Secret ref name", "Secret alt", "json value", "42");
    }

    @Test
    void staleEditorValuesAreIgnoredAndAMissingTemplateIndexesStringLeaves() {
        context.pages.put(pageTemplate, cdl("editor text kept { label \"Kept\" }"));
        SearchDocument doc = page("{'templateRef':'" + pageTemplate + "','content':{'kept':'current','removed':'stale value'}}");
        assertThat(doc.text()).isEqualTo("current");

        SearchDocument orphan = page("{'templateRef':'" + UUID.randomUUID() + "','content':{"
                + "'a':'<p>leaf <em>one</em></p>','b':[{'c':'leaf two','instanceId':'x1'}],'d':'" + UUID.randomUUID() + "'}}");
        assertThat(orphan.text()).isEqualTo("leaf one\nleaf two");
    }

    @Test
    void mediaMetadataAndProcessedTextAreIncluded() {
        SearchDocument image = extract(AssetType.MEDIA, "hero", "Hero", json(
                "{'fileName':'hero.jpg','mimeType':'image/jpeg','altText':'A lighthouse at dusk','caption':'Harbour',"
                        + "'copyright':'Jane Doe','blobSha256':'abc'}")).orElseThrow();
        assertThat(image.text()).contains("hero.jpg", "A lighthouse at dusk", "Harbour", "Jane Doe");
        assertThat(image.source()).isEmpty();

        context.blobs.put("css", "body { color: tomato; }");
        SearchDocument css = extract(AssetType.MEDIA, "site_css", "site.css", json(
                "{'fileName':'site.css','mimeType':'text/css','processCms':true,'blobSha256':'css'}")).orElseThrow();
        assertThat(css.source()).isEqualTo("body { color: tomato; }");

        context.blobs.put("plain", "not processed");
        SearchDocument unprocessed = extract(AssetType.MEDIA, "txt", "a.txt", json(
                "{'fileName':'a.txt','mimeType':'text/plain','processCms':false,'blobSha256':'plain'}")).orElseThrow();
        assertThat(unprocessed.source()).isEmpty();
    }

    @Test
    void templateSourcesAreCodeOnly() {
        SearchDocument doc = extract(AssetType.SECTION_TEMPLATE, "teaser", "Teaser", json(
                "{'contentDefinition':'editor text headline { label \\'Headline\\' }',"
                        + "'channelTemplates':{'html':{'source':'<h2>$CMS_VALUE(headline)$</h2>'},'md':{'source':'## md'}}}"))
                .orElseThrow();

        assertThat(doc.text()).isEmpty();
        assertThat(doc.source()).contains("editor text headline", "<h2>$CMS_VALUE(headline)$</h2>", "## md");
        assertThat(doc.title()).isEqualTo("Teaser teaser");
    }

    @Test
    void datasetSchemaIndexesCdlAndDescription() {
        SearchDocument doc = extract(AssetType.DATASET, "team", "Team", json(
                "{'contentDefinition':'editor text role { label \\'Role\\' }','description':'Our people'}")).orElseThrow();
        assertThat(doc.text()).isEqualTo("Our people");
        assertThat(doc.source()).contains("editor text role");
    }

    @Test
    void pageReferenceLabelIsIncluded() {
        SearchDocument doc = extract(AssetType.PAGE_REFERENCE, "about_ref", "About", json("{'label':'About the team'}"))
                .orElseThrow();
        assertThat(doc.text()).isEqualTo("About the team");
    }

    @Test
    void storeRootFoldersProduceNoDocument() {
        assertThat(extract(AssetType.FOLDER, "pages_root", "Pages", json("{'scope':'PAGES'}"))).isEmpty();
        assertThat(extract(AssetType.FOLDER, "root", "Root", json("{}"))).isEmpty();
        assertThat(extract(AssetType.FOLDER, "page_templates", "Page templates", json("{'scope':'TEMPLATES','protected':true}")))
                .isEmpty();
        assertThat(extract(AssetType.FOLDER, "news", "News", json("{'scope':'PAGES'}")))
                .map(SearchDocument::title)
                .hasValue("News news");
    }

    @Test
    void globalSetAndRecordValuesUseTheirDefinitions() {
        SearchDocument set = extract(AssetType.GLOBAL_SET, "footer", "Footer", json(
                "{'contentDefinition':'editor text claim { label \\'Claim\\' }','content':{'claim':'Built to last','x':'stale'}}"))
                .orElseThrow();
        assertThat(set.text()).isEqualTo("Built to last");

        context.datasets.put(dataset, cdl("editor text role { label \"Role\" }"));
        SearchDocument record = extract(AssetType.RECORD, "jane", "Jane", json(
                "{'datasetRef':'" + dataset + "','content':{'role':'Lighthouse keeper','old':'stale'}}")).orElseThrow();
        assertThat(record.text()).isEqualTo("Lighthouse keeper");
    }

    @Test
    void aRecordSetIsFoundByItsNameAndItsDatasetName() {
        UUID team = UUID.randomUUID();
        context.datasetNames.put(team, "Team members");
        SearchDocument set = registry.extract(
                new IndexableAsset(UUID.randomUUID(), AssetType.RECORD_SET, "leadership", "Leadership", "/content_root/",
                        team, 5, json("{'datasetRef':'" + team + "','query':{'sort':'-joined'}}")),
                context).orElseThrow();

        assertThat(set.title()).isEqualTo("Leadership leadership");
        assertThat(set.text()).isEqualTo("Team members");
    }

    @Test
    void textIsCappedAtAWordBoundary() {
        context.pages.put(pageTemplate, cdl("editor textarea body { label \"Body\" }"));
        context.maxChars = 20;
        SearchDocument doc = page("{'templateRef':'" + pageTemplate + "','content':{'body':'alpha beta gamma delta epsilon'}}");
        assertThat(doc.text()).isEqualTo("alpha beta gamma");
    }

    private static final class FakeContext implements ExtractionContext {
        final Map<UUID, ContentDefinition> pages = new HashMap<>();
        final Map<UUID, ContentDefinition> sections = new HashMap<>();
        final Map<UUID, ContentDefinition> datasets = new HashMap<>();
        final Map<UUID, String> datasetNames = new HashMap<>();
        final Map<String, String> blobs = new HashMap<>();
        int maxChars = 200_000;

        @Override
        public Optional<ContentDefinition> pageTemplateDefinition(UUID pageTemplate) {
            return Optional.ofNullable(pages.get(pageTemplate));
        }

        @Override
        public Optional<ContentDefinition> sectionTemplateDefinition(UUID sectionTemplate) {
            return Optional.ofNullable(sections.get(sectionTemplate));
        }

        @Override
        public Optional<ContentDefinition> datasetDefinition(UUID dataset) {
            return Optional.ofNullable(datasets.get(dataset));
        }

        @Override
        public Optional<String> datasetName(UUID dataset) {
            return Optional.ofNullable(datasetNames.get(dataset));
        }

        @Override
        public ContentDefinition definition(UUID owner, long revision, String cdlSource) {
            return cdl(cdlSource == null ? "" : cdlSource);
        }

        @Override
        public Optional<String> blobText(String sha256) {
            return Optional.ofNullable(blobs.get(sha256));
        }

        @Override
        public int maxTextChars() {
            return maxChars;
        }
    }
}
