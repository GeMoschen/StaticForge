package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.media.Blob;
import com.acme.staticforge.asset.media.BlobRepository;
import com.acme.staticforge.asset.media.MediaBinary;
import com.acme.staticforge.asset.media.MediaService;
import com.acme.staticforge.project.CreateProjectRequest;
import com.acme.staticforge.project.Project;
import com.acme.staticforge.project.ProjectService;
import com.acme.staticforge.revision.RevisionContext;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Media upload integration (spec §11, §20.2). Verifies the content-addressed upload flow end
 * to end: a MEDIA asset is created with a blobSha256, the MIME type is sniffed (never the
 * client-supplied value), sizeBytes is recorded, a variant blob is produced, binaries are
 * servable, and re-uploading identical bytes dedupes by SHA-256.
 */
@SpringBootTest
@ActiveProfiles("test")
class MediaUploadIntegrationTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired UserService userService;
    @Autowired ProjectService projectService;
    @Autowired AssetService assetService;
    @Autowired MediaService mediaService;
    @Autowired BlobRepository blobRepository;

    @Test
    void uploadCreatesMediaAssetWithSniffedMimeSizeAndVariants() {
        Fixture fx = newFixture();
        byte[] png = solidPng(640, 480, Color.RED);

        AssetVersionView uploaded = mediaService.upload(
                fx.project().getId(), null, "hero.png", "text/plain", png, fx.ctx());

        assertThat(uploaded.type()).isEqualTo(AssetType.MEDIA);

        JsonNode payload = uploaded.payload();
        String sha = payload.path("blobSha256").asText();
        assertThat(sha).hasSize(64);
        assertThat(payload.path("mimeType").asText()).isEqualTo("image/png");
        assertThat(payload.path("sizeBytes").asLong()).isPositive();

        JsonNode variants = payload.get("variants");
        assertThat(variants).isNotNull();
        assertThat(variants).isNotEmpty();
        String variantSha = variants.get(0).path("blobSha256").asText();
        assertThat(blobRepository.findById(variantSha)).isPresent();

        assertThat(blobRepository.findById(sha)).isPresent();
    }

    @Test
    void binaryReturnsStoredBytesBothOriginalAndVariant() {
        Fixture fx = newFixture();
        byte[] png = solidPng(640, 480, Color.BLUE);

        AssetVersionView uploaded = mediaService.upload(fx.project().getId(), null, "blue.png", "image/jpeg", png, fx.ctx());

        MediaBinary original = mediaService.binary(fx.project().getId(), uploaded.uuid(), null);
        assertThat(original.mimeType()).isEqualTo("image/png");
        assertThat(original.bytes()).isNotEmpty();

        JsonNode variants = uploaded.payload().get("variants");
        String variantName = variants.get(0).path("name").asText();
        MediaBinary variant = mediaService.binary(fx.project().getId(), uploaded.uuid(), variantName);
        assertThat(variant.mimeType()).isEqualTo("image/jpeg");
        assertThat(variant.bytes()).isNotEmpty();
    }

    @Test
    void reuploadingIdenticalBytesDedupesBySha256() {
        Fixture fx = newFixture();
        byte[] png = solidPng(320, 200, Color.GREEN);

        AssetVersionView first = mediaService.upload(fx.project().getId(), null, "same.png", "image/png", png, fx.ctx());
        AssetVersionView second = mediaService.upload(fx.project().getId(), null, "same2.png", "image/png", png, fx.ctx());

        String firstSha = first.payload().path("blobSha256").asText();
        String secondSha = second.payload().path("blobSha256").asText();
        assertThat(firstSha).isEqualTo(secondSha);

        Blob blob = blobRepository.findById(firstSha).orElseThrow();
        assertThat(blob.getRefCount()).isEqualTo(2);
        assertThat(first.uuid()).isNotEqualTo(second.uuid());
    }

    private static byte[] solidPng(int width, int height, Color color) {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setColor(color);
        g.fillRect(0, 0, width, height);
        g.dispose();
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            ImageIO.write(image, "png", bos);
            return bos.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Fixture newFixture() {
        int n = SEQ.incrementAndGet();
        AppUser user = userService.create("media-user-" + n, "media-user-" + n + "@example.com",
                "Media User " + n, "secret-password");
        Project project = projectService.create(
                new CreateProjectRequest("mediap_" + n, "Media Project " + n, null, null), user.getId());
        return new Fixture(project, user);
    }

    private record Fixture(Project project, AppUser user) {
        RevisionContext ctx() {
            return RevisionContext.of(project().getId(), user().getId(), "media test");
        }
    }
}
