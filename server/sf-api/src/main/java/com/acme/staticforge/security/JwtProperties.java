package com.acme.staticforge.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Typed binding for {@code sf.security.jwt.*} (spec §9.1, §9.3). Durations use Spring's
 * simple style ({@code 15m}, {@code 8h}, {@code 30d}).
 *
 * <p>Only HS256 is implemented in code today; {@code algorithm}, {@code key-store} and the
 * other fields are read so the configuration surface is stable when RS256 + JWKS key
 * management arrives (a documented follow-up, spec §9.3).
 */
@ConfigurationProperties(prefix = "sf.security.jwt")
public class JwtProperties {

    private String algorithm = "HS256";

    private String issuer = "https://cms.example.com";

    private String secret = "";

    private String keyStore;

    private Duration accessTokenTtl = Duration.ofMinutes(15);

    private Duration refreshTokenTtl = Duration.ofHours(8);

    private Duration refreshTokenAbsoluteTtl = Duration.ofDays(30);

    public String getAlgorithm() {
        return algorithm;
    }

    public void setAlgorithm(String algorithm) {
        this.algorithm = algorithm;
    }

    public String getIssuer() {
        return issuer;
    }

    public void setIssuer(String issuer) {
        this.issuer = issuer;
    }

    public String getSecret() {
        return secret;
    }

    public void setSecret(String secret) {
        this.secret = secret;
    }

    public String getKeyStore() {
        return keyStore;
    }

    public void setKeyStore(String keyStore) {
        this.keyStore = keyStore;
    }

    public Duration getAccessTokenTtl() {
        return accessTokenTtl;
    }

    public void setAccessTokenTtl(Duration accessTokenTtl) {
        this.accessTokenTtl = accessTokenTtl;
    }

    public Duration getRefreshTokenTtl() {
        return refreshTokenTtl;
    }

    public void setRefreshTokenTtl(Duration refreshTokenTtl) {
        this.refreshTokenTtl = refreshTokenTtl;
    }

    public Duration getRefreshTokenAbsoluteTtl() {
        return refreshTokenAbsoluteTtl;
    }

    public void setRefreshTokenAbsoluteTtl(Duration refreshTokenAbsoluteTtl) {
        this.refreshTokenAbsoluteTtl = refreshTokenAbsoluteTtl;
    }
}
