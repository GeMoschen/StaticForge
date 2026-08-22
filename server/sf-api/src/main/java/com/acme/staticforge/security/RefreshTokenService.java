package com.acme.staticforge.security;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Server-side refresh-token rotation (spec §9.1, §9.4). Tokens belong to a family; a
 * consumed (revoked) token presented again signals theft and revokes the entire family.
 * Sliding {@code expiresAt} (8h) with an absolute ceiling (30d), both from config.
 */
@Service
public class RefreshTokenService {

    private static final Logger LOG = LoggerFactory.getLogger(RefreshTokenService.class);

    private final RefreshTokenRepository repository;
    private final JwtProperties properties;
    private final Clock clock;
    private final SecureRandom secureRandom = new SecureRandom();

    public RefreshTokenService(RefreshTokenRepository repository, JwtProperties properties, Clock clock) {
        this.repository = repository;
        this.properties = properties;
        this.clock = clock;
    }

    /** Issues a new token family for the user and returns the persisted token row. */
    @Transactional
    public RefreshToken issue(Long userId) {
        Instant now = clock.instant();
        RefreshToken token = new RefreshToken(
                userId,
                UUID.randomUUID().toString(),
                newTokenValue(),
                now,
                now.plus(properties.getRefreshTokenTtl()),
                now.plus(properties.getRefreshTokenAbsoluteTtl()));
        return repository.save(token);
    }

    /**
     * Rotates a presented refresh token. An active token is revoked and replaced by a new
     * token in the same family (sliding expiry, capped at the family's absolute ceiling). A
     * revoked token indicates theft and revokes the whole family.
     */
    @Transactional
    public RefreshToken rotate(String presentedToken) {
        RefreshToken presented = repository
                .findByToken(presentedToken)
                .orElseThrow(() -> new SfException(ProblemFactory.unauthorized("Invalid refresh token.")));

        if (presented.isRevoked()) {
            repository.deleteByFamilyId(presented.getFamilyId());
            LOG.warn("Refresh-token reuse detected; invalidated family {}", presented.getFamilyId());
            throw new SfException(ProblemFactory.unauthorized("Refresh token reuse detected; please log in again."));
        }

        Instant now = clock.instant();
        if (now.isAfter(presented.getExpiresAt()) || now.isAfter(presented.getAbsoluteExpiresAt())) {
            repository.deleteByFamilyId(presented.getFamilyId());
            throw new SfException(ProblemFactory.unauthorized("Refresh token expired."));
        }

        presented.setRevoked(true);
        repository.save(presented);

        Instant expiresAt = now.plus(properties.getRefreshTokenTtl());
        if (expiresAt.isAfter(presented.getAbsoluteExpiresAt())) {
            expiresAt = presented.getAbsoluteExpiresAt();
        }
        RefreshToken next = new RefreshToken(
                presented.getUserId(),
                presented.getFamilyId(),
                newTokenValue(),
                now,
                expiresAt,
                presented.getAbsoluteExpiresAt());
        return repository.save(next);
    }

    /** Revokes the presented token (logout of a single device family). */
    @Transactional
    public void revokeFamily(String presentedToken) {
        repository
                .findByToken(presentedToken)
                .ifPresent(token -> repository.deleteByFamilyId(token.getFamilyId()));
    }

    /** Revokes every refresh token for the user (e.g. password change). */
    @Transactional
    public void revokeAll(Long userId) {
        repository.deleteByUserId(userId);
    }

    private String newTokenValue() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return UUID.randomUUID().toString().replace("-", "") + HexFormat.of().formatHex(bytes);
    }
}
