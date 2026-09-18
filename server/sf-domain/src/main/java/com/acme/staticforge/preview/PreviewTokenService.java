package com.acme.staticforge.preview;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Issues and verifies signed, expiring preview share tokens (spec §19.3). A share token is a
 * compact HS256 JWS whose claims bind a single page (+ revision + channel + project) for a
 * read-only, authenticated share route. The HMAC key is {@code sf.security.jwt.secret}; when
 * unset we fall back to the same placeholder as the access-token security chain (no real
 * tokens are accepted in that case anyway).
 *
 * <p>Deliberately dependency-light: implemented with the JDK's {@link Mac} HMAC-SHA256 rather
 * than the Spring Security oauth2-jose stack so it can live in {@code sf-domain} (which does
 * not depend on {@code sf-api}'s security wiring).
 */
@Service
public class PreviewTokenService {

    private static final String PLACEHOLDER_SECRET = "staticforge-deferred-rs256-not-for-production";
    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final long DEFAULT_TTL_SECONDS = 7L * 24L * 60L * 60L;

    private final String secret;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public PreviewTokenService(
            @Value("${sf.security.jwt.secret:}") String secret, ObjectMapper objectMapper, Clock clock) {
        this.secret = secret == null || secret.isBlank() ? PLACEHOLDER_SECRET : secret;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    /**
     * Issues a share token valid for 7 days for the given page/revision/channel/project.
     *
     * @param pageUuid the page to share
     * @param revision the revision to pin (latest when {@code null})
     * @param channel the channel to render
     * @param projectKey the owning project
     * @return a compact HS256 JWS
     */
    public String issueShareToken(UUID pageUuid, Long revision, String channel, String projectKey) {
        return issueShareToken(pageUuid, revision, channel, projectKey, null);
    }

    /**
     * Issues a share token bound to one language (M24.3.2), so a shared link opens the page in the
     * language the editor was looking at. {@code null} means the project's default language, which
     * is also what every token issued before M24 carries.
     */
    public String issueShareToken(UUID pageUuid, Long revision, String channel, String projectKey, String locale) {
        return issueAssetShareToken("page", pageUuid, revision, channel, projectKey, locale);
    }

    /**
     * Issues a share token for a media asset's binary — used by {@code PageRenderService}'s
     * {@code urlResolver} to rewrite MEDIA references inside rendered preview HTML, since
     * {@code MediaController}'s normal {@code /binary} route is Bearer-only and the preview is
     * loaded by the browser's own (unauthenticated) frame navigation / {@code <img src>} fetch.
     *
     * @param revision the preview revision the media is served at (M18.3.2: a processed file renders
     *     with that revision's values), or {@code null} for the current state; tokens issued before the
     *     claim existed carry none and keep meaning "current"
     */
    public String issueMediaShareToken(UUID mediaUuid, Long revision, String projectKey) {
        return issueAssetShareToken("media", mediaUuid, revision, null, projectKey, null);
    }

    private String issueAssetShareToken(
            String kind, UUID assetUuid, Long revision, String channel, String projectKey, String locale) {
        Instant now = clock.instant();
        StringBuilder payload = new StringBuilder("{");
        payload.append("\"sub\":\"viewer\"");
        payload.append(",\"kind\":\"").append(kind).append('"');
        payload.append(",\"pageUuid\":\"").append(assetUuid).append('"');
        if (revision != null) {
            payload.append(",\"revision\":").append(revision);
        }
        if (channel != null && !channel.isBlank()) {
            payload.append(",\"channel\":\"").append(channel).append('"');
        }
        if (projectKey != null && !projectKey.isBlank()) {
            payload.append(",\"projectKey\":\"").append(projectKey).append('"');
        }
        if (locale != null && !locale.isBlank()) {
            payload.append(",\"locale\":\"").append(locale).append('"');
        }
        payload.append(",\"iat\":").append(now.getEpochSecond());
        payload.append(",\"exp\":").append(now.getEpochSecond() + DEFAULT_TTL_SECONDS);
        payload.append('}');

        return sign(payload.toString());
    }

    /**
     * Verifies a page share token and returns its bound target.
     *
     * @throws SfException (401) when the token is malformed, tampered with, expired, or was
     *     issued for a different asset kind (e.g. a media token presented here)
     */
    public ShareTarget verifyShareToken(String token) {
        ShareTarget target = verifyAssetShareToken(token);
        if (!"page".equals(target.kind())) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }
        return target;
    }

    /**
     * Verifies a media share token (see {@link #issueMediaShareToken}) and returns its bound
     * target.
     *
     * @throws SfException (401) when the token is malformed, tampered with, expired, or was
     *     issued for a different asset kind
     */
    public ShareTarget verifyMediaShareToken(String token) {
        ShareTarget target = verifyAssetShareToken(token);
        if (!"media".equals(target.kind())) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }
        return target;
    }

    private ShareTarget verifyAssetShareToken(String token) {
        if (token == null || token.isBlank()) {
            throw new SfException(ProblemFactory.unauthorized("Missing share token."));
        }
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }
        String expected = hmac(parts[0] + "." + parts[1]);
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), parts[2].getBytes(StandardCharsets.UTF_8))) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }

        JsonNode claims;
        try {
            claims = objectMapper.readTree(Base64.getUrlDecoder().decode(parts[1]));
        } catch (IOException | IllegalArgumentException e) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }

        Instant now = clock.instant();
        if (claims.path("exp").isMissingNode() || !claims.path("exp").isIntegralNumber()
                || claims.path("exp").asLong() <= now.getEpochSecond()) {
            throw new SfException(ProblemFactory.unauthorized("Share link has expired."));
        }

        String pageUuid = claims.path("pageUuid").asText();
        if (pageUuid == null || pageUuid.isBlank()) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }
        // Tokens issued before the "kind" claim existed are all page tokens.
        String kind = blankToNull(claims.path("kind").asText(null));
        ShareTarget target;
        try {
            target = new ShareTarget(
                    kind == null ? "page" : kind,
                    UUID.fromString(pageUuid),
                    claims.path("revision").isNumber() ? claims.path("revision").asLong() : null,
                    blankToNull(claims.path("channel").asText(null)),
                    blankToNull(claims.path("projectKey").asText(null)),
                    blankToNull(claims.path("locale").asText(null)));
        } catch (IllegalArgumentException e) {
            throw new SfException(ProblemFactory.unauthorized("Invalid share token."));
        }
        return target;
    }

    private String sign(String payloadJson) {
        String header = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
        String headerB64 = b64Url(header.getBytes(StandardCharsets.UTF_8));
        String payloadB64 = b64Url(payloadJson.getBytes(StandardCharsets.UTF_8));
        String signature = hmac(headerB64 + "." + payloadB64);
        return headerB64 + "." + payloadB64 + "." + signature;
    }

    private String hmac(String unsigned) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_ALGORITHM));
            return b64Url(mac.doFinal(unsigned.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }

    private static String b64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * The asset target bound to a verified share token — {@code kind} is {@code "page"} or
     * {@code "media"}. {@code locale} is the language the link opens in (M24.3.2), {@code null} for
     * the project's default language and for every token issued before M24.
     */
    public record ShareTarget(
            String kind, UUID pageUuid, Long revision, String channel, String projectKey, String locale) {

        /** A target without a language. */
        public ShareTarget(String kind, UUID pageUuid, Long revision, String channel, String projectKey) {
            this(kind, pageUuid, revision, channel, projectKey, null);
        }
    }
}
