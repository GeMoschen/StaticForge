package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.asset.AssetRepository;
import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.MediaFiles;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.LocaleConfig;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectLocale;
import com.acme.staticforge.project.ProjectRole;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.release.AssetRelease;
import com.acme.staticforge.release.AssetReleaseRepository;
import com.acme.staticforge.release.ChangesService;
import com.acme.staticforge.release.ReleaseItem;
import com.acme.staticforge.release.ReleaseLocales;
import com.acme.staticforge.release.ReleaseService;
import com.acme.staticforge.release.ReleaseStatus;
import com.acme.staticforge.release.ReleaseStatusService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.revision.RevisionRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Localized media (M27.3.1): the {@code localized} flag, one file per locale with fallback along the chain, the toggle
 * both ways with its release pointers, per-locale upload/replace/remove through the upload pipeline, per-locale
 * release status and the Changes candidates. The media size cap is lowered to 4KB (as in {@code MediaTextApiTest}) so
 * the oversized case stays small.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "sf.media.max-upload-size=4KB")
class LocalizedMediaIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired AssetRepository assetRepository;
    @Autowired MediaService mediaService;
    @Autowired BlobRepository blobRepository;
    @Autowired ReleaseService releases;
    @Autowired ReleaseStatusService statuses;
    @Autowired AssetReleaseRepository releaseRepository;
    @Autowired ChangesService changes;
    @Autowired RevisionRepository revisionRepository;

    @Test
    @DisplayName("A localized image resolves each language along its chain: own file, fallback locale, default file")
    void filesResolveAlongTheChain() throws Exception {
        Fixture fx = newFixture();
        // fr is the default; de-CH falls back to de.
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(
                        List.of(locale("fr"), locale("en"), locale("de"), locale("de-CH"), locale("it")),
                        "fr",
                        Map.of("de-CH", List.of("de")),
                        false),
                true,
                fx.ctx());
        AssetVersionView media = localize(fx, upload(fx, "hero.png", png(Color.RED)));
        byte[] english = png(Color.BLUE);
        byte[] german = png(Color.GREEN);

        putFile(fx, media, "en", "hero-en.png", english).andExpect(status().isOk())
                .andExpect(jsonPath("$.media.localized").value(true))
                .andExpect(jsonPath("$.media.localeFiles.en.own").value(true))
                .andExpect(jsonPath("$.media.localeFiles.en.fileName").value("hero-en.png"));
        JsonNode view = json(putFile(fx, media, "de", "hero-de.png", german)).path("media");

        JsonNode files = view.path("localeFiles");
        assertThat(files.path("fr").path("own").asBoolean()).isTrue();
        assertThat(files.path("de").path("fileName").asText()).isEqualTo("hero-de.png");
        assertThat(files.path("de-CH").path("own").asBoolean()).isFalse();
        assertThat(files.path("de-CH").path("fromLocale").asText()).isEqualTo("de");
        assertThat(files.path("it").path("fromLocale").asText()).isEqualTo("fr");
        assertThat(files.path("it").path("fileName").asText()).isEqualTo("hero.png");
        // The top-level fields stay the default file for every reader that doesn't know locales.
        assertThat(view.path("fileName").asText()).isEqualTo("hero.png");

        String deSha = files.path("de").path("blobSha256").asText();
        assertThat(mediaService.binary(fx.id(), media.uuid(), null, null, "de-CH").bytes())
                .isEqualTo(mediaService.binary(fx.id(), media.uuid(), null, null, "de").bytes());
        assertThat(blobRepository.findById(deSha)).isPresent();
        mvc.perform(get(url(fx, media) + "/binary").param("locale", "en")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(result -> assertThat(result.getResponse().getContentAsByteArray())
                        .isEqualTo(mediaService.binary(fx.id(), media.uuid(), null, null, "en").bytes()));

        // Each locale file has its own variants, generated like an upload's.
        JsonNode payload = mediaService.require(fx.id(), media.uuid()).payload();
        assertThat(payload.at("/localeFiles/en/variants")).isNotEmpty();
        assertThat(payload.at("/localeFiles/en/variants/0/blobSha256").asText())
                .isNotEqualTo(payload.at("/variants/0/blobSha256").asText());
    }

    @Test
    @DisplayName("Un-localizing lists the files it would discard, then keeps the default file in one revision")
    void unLocalizeAsksBeforeDiscarding() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en", "fr");
        AssetVersionView media = localize(fx, upload(fx, "logo.png", png(Color.RED)));
        releases.release(List.of(ReleaseItem.of(media.uuid())), fx.ctx());
        AssetVersionView withEnglish = mediaService
                .putLocaleFile(media.uuid(), "en", "logo-en.png", null, png(Color.BLUE), fx.ctx())
                .media();
        String defaultSha = withEnglish.payload().path("blobSha256").asText();

        mvc.perform(put(url(fx, media) + "/localized")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor()))
                        .header(HttpHeaders.IF_MATCH, etag(withEnglish.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"localized\":false}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SF-MEDIA-0505"))
                .andExpect(jsonPath("$.files.length()").value(1))
                .andExpect(jsonPath("$.files[0].locale").value("en"))
                .andExpect(jsonPath("$.files[0].fileName").value("logo-en.png"));
        assertThat(mediaService.require(fx.id(), media.uuid()).validFromRevision())
                .isEqualTo(withEnglish.validFromRevision());

        long revisionsBefore = revisionCount(fx);
        mvc.perform(put(url(fx, media) + "/localized")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor()))
                        .header(HttpHeaders.IF_MATCH, etag(withEnglish.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"localized\":false,\"confirmDiscard\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localized").value(false))
                .andExpect(jsonPath("$.localeFiles").doesNotExist())
                .andExpect(jsonPath("$.blobSha256").value(defaultSha));
        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore + 1);

        JsonNode payload = mediaService.require(fx.id(), media.uuid()).payload();
        assertThat(payload.has(MediaFiles.LOCALE_FILES)).isFalse();
        assertThat(payload.has(MediaFiles.LOCALIZED)).isFalse();
        // The per-locale pointers collapse to the shared one, carrying the default locale's (published) state.
        assertThat(openKeys(fx, media.uuid())).containsExactly(ReleaseLocales.ALL);
        assertThat(statusOf(fx, media.uuid())).containsExactly(Map.entry(ReleaseLocales.ALL, ReleaseStatus.PUBLISHED));
    }

    @Test
    @DisplayName("Localizing spreads the shared pointer to every locale, keeping its status; the value it has is a no-op")
    void localizeCarriesTheReleaseState() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        AssetVersionView published = upload(fx, "a.png", png(Color.RED));
        AssetVersionView changed = upload(fx, "b.png", png(Color.RED));
        releases.release(List.of(ReleaseItem.of(published.uuid()), ReleaseItem.of(changed.uuid())), fx.ctx());
        changed = mediaService.replace(changed.uuid(), "b2.png", null, png(Color.CYAN), fx.ctx()).media();

        localize(fx, published);
        localize(fx, changed);

        assertThat(statusOf(fx, published.uuid()))
                .containsExactly(Map.entry("de", ReleaseStatus.PUBLISHED), Map.entry("en", ReleaseStatus.PUBLISHED));
        assertThat(statusOf(fx, changed.uuid()))
                .containsExactly(Map.entry("de", ReleaseStatus.CHANGED), Map.entry("en", ReleaseStatus.CHANGED));
        assertThat(openKeys(fx, published.uuid())).containsExactlyInAnyOrder("de", "en");

        AssetVersionView current = mediaService.require(fx.id(), published.uuid());
        long revisionsBefore = revisionCount(fx);
        assertThat(mediaService.setLocalized(published.uuid(), true, false, current.validFromRevision(), fx.ctx())
                        .validFromRevision())
                .isEqualTo(current.validFromRevision());
        assertThat(revisionCount(fx)).isEqualTo(revisionsBefore);
    }

    @Test
    @DisplayName("Replacing only the English file makes only English CHANGED")
    void perLocaleStatus() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en", "fr");
        AssetVersionView media = localize(fx, upload(fx, "shot.png", png(Color.RED)));
        mediaService.putLocaleFile(media.uuid(), "en", "shot-en.png", null, png(Color.BLUE), fx.ctx());
        releases.release(List.of(ReleaseItem.of(media.uuid())), fx.ctx());
        assertThat(statusOf(fx, media.uuid())).allSatisfy((locale, status) -> assertThat(status).isEqualTo(ReleaseStatus.PUBLISHED));

        mediaService.putLocaleFile(media.uuid(), "en", "shot-en.png", null, png(Color.MAGENTA), fx.ctx());
        assertThat(statusOf(fx, media.uuid())).containsExactly(
                Map.entry("de", ReleaseStatus.PUBLISHED),
                Map.entry("en", ReleaseStatus.CHANGED),
                Map.entry("fr", ReleaseStatus.PUBLISHED));

        // Replacing the default file changes the default and every locale that falls back to it.
        mediaService.replace(media.uuid(), "shot.png", null, png(Color.YELLOW), fx.ctx());
        assertThat(statusOf(fx, media.uuid())).containsExactly(
                Map.entry("de", ReleaseStatus.CHANGED),
                Map.entry("en", ReleaseStatus.CHANGED),
                Map.entry("fr", ReleaseStatus.CHANGED));

        // Discarding English restores its released file and leaves the other drafts alone.
        releases.discard(List.of(ReleaseItem.of(media.uuid(), "en")), fx.ctx());
        assertThat(statusOf(fx, media.uuid())).containsEntry("en", ReleaseStatus.PUBLISHED).containsEntry("de", ReleaseStatus.CHANGED);

        // Removing English's own file lets it fall back again: its projection changes, so it is CHANGED.
        mediaService.removeLocaleFile(media.uuid(), "en", fx.ctx());
        assertThat(mediaService.require(fx.id(), media.uuid()).payload().path(MediaFiles.LOCALE_FILES).has("en")).isFalse();
        assertThat(statusOf(fx, media.uuid())).containsEntry("en", ReleaseStatus.CHANGED);
    }

    @Test
    @DisplayName("Locale files go through the upload pipeline: MIME sniffing, SVG sanitizing, size cap")
    void uploadRulesApplyToLocaleFiles() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        AssetVersionView media = localize(fx, upload(fx, "icon.svg", svg("<circle r=\"4\"/>")));

        // The client's type is never trusted: a PNG sent as text/plain is stored as image/png.
        JsonNode sniffed = json(mvc.perform(multipart(url(fx, media) + "/files/en")
                        .file(new MockMultipartFile("file", "en.png", "text/plain", png(Color.RED)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isOk()));
        assertThat(sniffed.at("/media/localeFiles/en/mimeType").asText()).isEqualTo("image/png");

        mediaService.putLocaleFile(media.uuid(), "en", "en.svg", "image/svg+xml",
                svg("<script>alert(1)</script><circle r=\"4\"/>"), fx.ctx());
        String english = new String(mediaService.binary(fx.id(), media.uuid(), null, null, "en").bytes(), StandardCharsets.UTF_8);
        assertThat(english).contains("circle").doesNotContain("script");

        mvc.perform(multipart(url(fx, media) + "/files/en")
                        .file(new MockMultipartFile("file", "big.txt", "text/plain", new byte[5 * 1024]))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("SF-MEDIA-0413"));

        // Viewers can't upload.
        mvc.perform(multipart(url(fx, media) + "/files/en")
                        .file(new MockMultipartFile("file", "en.png", "image/png", png(Color.RED)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Refusals: media not localized, unknown locale, project without locales, removing the default file")
    void refusals() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        AssetVersionView plain = upload(fx, "plain.png", png(Color.RED));
        mvc.perform(multipart(url(fx, plain) + "/files/en")
                        .file(new MockMultipartFile("file", "en.png", "image/png", png(Color.BLUE)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-MEDIA-0506"));

        AssetVersionView media = localize(fx, upload(fx, "loc.png", png(Color.RED)));
        mvc.perform(multipart(url(fx, media) + "/files/fr")
                        .file(new MockMultipartFile("file", "fr.png", "image/png", png(Color.BLUE)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-MEDIA-0507"));
        mvc.perform(delete(url(fx, media) + "/files/de").header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-MEDIA-0509"));
        // A locale without its own file: nothing to remove, no revision.
        long before = revisionCount(fx);
        mvc.perform(delete(url(fx, media) + "/files/en").header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())))
                .andExpect(status().isOk());
        assertThat(revisionCount(fx)).isEqualTo(before);

        Fixture single = newFixture();
        AssetVersionView media2 = upload(single, "one.png", png(Color.RED));
        mvc.perform(put(url(single, media2) + "/localized")
                        .header(HttpHeaders.AUTHORIZATION, bearer(single.editor()))
                        .header(HttpHeaders.IF_MATCH, etag(media2.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"localized\":true}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SF-MEDIA-0508"));
    }

    @Test
    @DisplayName("Text media: ?locale= reads the file a language renders and writes its own file")
    void textPerLocale() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        AssetVersionView css = localize(fx, upload(fx, "site.css", "a{color:red}".getBytes(StandardCharsets.UTF_8)));

        JsonNode saved = json(mvc.perform(put(url(fx, css) + "/text").param("locale", "en")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor()))
                        .header(HttpHeaders.IF_MATCH, etag(css.validFromRevision()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"a{color:blue}\"}"))
                .andExpect(status().isOk()));
        assertThat(saved.at("/media/localeFiles/en/own").asBoolean()).isTrue();
        assertThat(saved.at("/media/localeFiles/en/mimeType").asText()).isEqualTo("text/css");

        mvc.perform(get(url(fx, css) + "/text").param("locale", "en").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("a{color:blue}"));
        mvc.perform(get(url(fx, css) + "/text").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("a{color:red}"));

        // The processing flag is per file.
        long revision = saved.at("/media/revision").asLong();
        mvc.perform(put(url(fx, css) + "/process").param("locale", "en")
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor()))
                        .header(HttpHeaders.IF_MATCH, etag(revision))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"processCms\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.media.localeFiles.en.processCms").value(true))
                .andExpect(jsonPath("$.media.localeFiles.de.processCms").value(false))
                .andExpect(jsonPath("$.media.processCms").value(false));
    }

    @Test
    @DisplayName("Changes: released in German only lists English as NEW; released everywhere at the draft is no candidate")
    void changesCandidates() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        AssetVersionView media = localize(fx, upload(fx, "c.png", png(Color.RED)));
        AssetVersionView plain = upload(fx, "p.png", png(Color.RED));
        releases.release(List.of(ReleaseItem.of(media.uuid(), "de"), ReleaseItem.of(plain.uuid())), fx.ctx());

        assertThat(rows(fx)).containsExactly(media.uuid() + "|en|NEW");

        releases.release(List.of(ReleaseItem.of(media.uuid(), "en")), fx.ctx());
        assertThat(rows(fx)).isEmpty();
    }

    @Test
    @DisplayName("Every media write keeps the media columns, so the library's MIME filter still finds the file")
    void metadataEditsKeepTheMimeFilter() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        AssetVersionView media = upload(fx, "kept.png", png(Color.RED));
        mediaService.updateMetadata(media.uuid(), "Alt", null, null, null, "en", media.validFromRevision(), fx.ctx());
        localize(fx, mediaService.require(fx.id(), media.uuid()));

        assertThat(mediaService.list(fx.id(), "image/*", null, false, null, PageRequest.of(0, 10)).getContent())
                .extracting(AssetVersionView::uuid)
                .containsExactly(media.uuid());
        // The English alt text survives a replace of the file (it used to be rebuilt from plain strings).
        mediaService.replace(media.uuid(), "kept.png", null, png(Color.BLUE), fx.ctx());
        assertThat(mediaService.require(fx.id(), media.uuid()).payload().at("/altText/values/en").asText(null))
                .isNotNull();
    }

    @Test
    @DisplayName("A locale file's blob counts a reference like an upload's")
    void localeBlobsAreCounted() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        byte[] bytes = png(Color.ORANGE);
        AssetVersionView media = localize(fx, upload(fx, "r.png", png(Color.RED)));
        mediaService.putLocaleFile(media.uuid(), "en", "r-en.png", null, bytes, fx.ctx());
        String sha = mediaService.require(fx.id(), media.uuid()).payload().at("/localeFiles/en/blobSha256").asText();
        long refs = blobRepository.findById(sha).orElseThrow().getRefCount();

        mediaService.putLocaleFile(media.uuid(), "en", "r-en.png", null, bytes, fx.ctx());
        assertThat(blobRepository.findById(sha).orElseThrow().getRefCount()).isEqualTo(refs + 1);
    }

    @Test
    @DisplayName("Removing a locale from the project hides its file; the service refuses the locale from then on")
    void removedLocale() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en");
        AssetVersionView media = localize(fx, upload(fx, "x.png", png(Color.RED)));
        mediaService.putLocaleFile(media.uuid(), "en", "x-en.png", null, png(Color.BLUE), fx.ctx());
        enableLocales(fx, "de");

        assertThatThrownBy(() -> mediaService.putLocaleFile(media.uuid(), "en", "x.png", null, png(Color.BLUE), fx.ctx()))
                .isInstanceOfSatisfying(SfException.class, e ->
                        assertThat(e.getProblem().getExtensions()).containsEntry("code", "SF-MEDIA-0507"));
        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/media").header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].localized").value(true));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private AssetVersionView upload(Fixture fx, String name, byte[] bytes) {
        return mediaService.upload(fx.id(), null, name, null, bytes, fx.ctx());
    }

    @Test
    @DisplayName("GET /media/{uuid} carries the resolved per-language files, now and at an earlier revision")
    void detailCarriesLocaleFiles() throws Exception {
        Fixture fx = newLocalizedFixture("de", "en", "fr");
        AssetVersionView media = localize(fx, upload(fx, "hero.png", png(Color.RED)));
        long before = mediaService.require(fx.id(), media.uuid()).validFromRevision();
        putFile(fx, media, "en", "hero-en.png", png(Color.BLUE)).andExpect(status().isOk());

        mvc.perform(get(url(fx, media)).header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(header().exists(HttpHeaders.ETAG))
                .andExpect(jsonPath("$.localized").value(true))
                .andExpect(jsonPath("$.localeFiles.de.own").value(true))
                .andExpect(jsonPath("$.localeFiles.en.own").value(true))
                .andExpect(jsonPath("$.localeFiles.en.fileName").value("hero-en.png"))
                .andExpect(jsonPath("$.localeFiles.fr.own").value(false))
                .andExpect(jsonPath("$.localeFiles.fr.fromLocale").value("de"))
                .andExpect(jsonPath("$.release.de.status").value("NEW"));

        mvc.perform(get(url(fx, media)).param("revision", String.valueOf(before))
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.localeFiles.en.own").value(false))
                .andExpect(jsonPath("$.localeFiles.en.fromLocale").value("de"));

        mvc.perform(get("/api/v1/projects/" + fx.project().getKey() + "/media/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(fx.viewer())))
                .andExpect(status().isNotFound());
    }

    private AssetVersionView localize(Fixture fx, AssetVersionView media) {
        AssetVersionView current = mediaService.require(fx.id(), media.uuid());
        return mediaService.setLocalized(media.uuid(), true, false, current.validFromRevision(), fx.ctx());
    }

    private ResultActions putFile(Fixture fx, AssetVersionView media, String locale, String name, byte[] bytes)
            throws Exception {
        return mvc.perform(multipart(url(fx, media) + "/files/" + locale)
                .file(new MockMultipartFile("file", name, "image/png", bytes))
                .header(HttpHeaders.AUTHORIZATION, bearer(fx.editor())));
    }

    private List<String> rows(Fixture fx) {
        return changes.list(fx.id(), new ChangesService.Query(null, null, null, null, null, null, null), 0, 50).rows().stream()
                .map(r -> r.uuid() + "|" + r.locale() + "|" + r.status())
                .toList();
    }

    private Map<String, ReleaseStatus> statusOf(Fixture fx, UUID uuid) {
        return statuses.ofAsset(fx.id(), uuid).entrySet().stream()
                .collect(Collectors.toMap(
                        Map.Entry::getKey, e -> e.getValue().status(), (a, b) -> a, java.util.LinkedHashMap::new));
    }

    private List<String> openKeys(Fixture fx, UUID uuid) {
        long assetId = assetRepository.findByProjectIdAndUuid(fx.id(), uuid).orElseThrow().getId();
        return releaseRepository.findByAssetIdAndValidToRevisionIsNull(assetId).stream()
                .map(AssetRelease::getLocaleKey)
                .toList();
    }

    private long revisionCount(Fixture fx) {
        return revisionRepository.findByProjectIdOrderByRevisionIdDesc(fx.id()).size();
    }

    private JsonNode json(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private static String url(Fixture fx, AssetVersionView media) {
        return "/api/v1/projects/" + fx.project().getKey() + "/media/" + media.uuid();
    }

    private static String etag(long revision) {
        return "\"rev-" + revision + "\"";
    }

    private String bearer(AppUser user) {
        return "Bearer " + jwtService.issueAccessToken(user);
    }

    private static ProjectLocale locale(String code) {
        return new ProjectLocale(code, code);
    }

    private static byte[] png(Color color) throws Exception {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, 8, 8);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private static byte[] svg(String body) {
        return ("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\">" + body + "</svg>")
                .getBytes(StandardCharsets.UTF_8);
    }

    private void enableLocales(Fixture fx, String... codes) {
        projectService.updateLocales(
                fx.project().getKey(),
                LocaleConfig.of(Arrays.stream(codes).map(LocalizedMediaIntegrationTest::locale).toList(), codes[0], Map.of(), false),
                true,
                fx.ctx());
    }

    private Fixture newLocalizedFixture(String... codes) {
        Fixture fx = newFixture();
        enableLocales(fx, codes);
        return fx;
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser admin = userService.create(
                "locmedia-admin-" + n, "locmedia-admin-" + n + "@example.com", "Loc Media Admin " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("locmedia_" + n, "Localized Media " + n, null, null), admin.getId());
        RevisionContext ctx = RevisionContext.of(project.getId(), admin.getId(), "test");
        AppUser editor = userService.create(
                "locmedia-editor-" + n, "locmedia-editor-" + n + "@example.com", "Loc Media Editor " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), editor.getId(), ProjectRole.EDITOR, ctx);
        AppUser viewer = userService.create(
                "locmedia-viewer-" + n, "locmedia-viewer-" + n + "@example.com", "Loc Media Viewer " + n, "secret-password");
        projectService.setMemberRole(project.getKey(), viewer.getId(), ProjectRole.VIEWER, ctx);
        return new Fixture(project, admin, editor, viewer);
    }

    private record Fixture(Project project, AppUser admin, AppUser editor, AppUser viewer) {
        long id() {
            return project.getId();
        }

        RevisionContext ctx() {
            return RevisionContext.of(project.getId(), admin.getId(), "test");
        }
    }
}
