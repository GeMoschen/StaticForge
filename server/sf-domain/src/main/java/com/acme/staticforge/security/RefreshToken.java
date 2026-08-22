package com.acme.staticforge.security;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * Server-side refresh token (spec §9.1, §9.4). Tokens belong to a rotation "family";
 * a consumed (revoked) token that is presented again indicates theft and revokes the
 * whole family (spec §9.4 "Reuse of a consumed refresh token invalidates the entire
 * family").
 */
@Entity
@Table(name = "refresh_token")
public class RefreshToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "family_id", nullable = false, length = 64)
    private String familyId;

    @Column(name = "token", nullable = false, unique = true, length = 128)
    private String token;

    @Column(name = "revoked", nullable = false)
    private boolean revoked;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "absolute_expires_at", nullable = false)
    private Instant absoluteExpiresAt;

    protected RefreshToken() {}

    public RefreshToken(Long userId, String familyId, String token, Instant createdAt, Instant expiresAt,
            Instant absoluteExpiresAt) {
        this.userId = userId;
        this.familyId = familyId;
        this.token = token;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
        this.absoluteExpiresAt = absoluteExpiresAt;
    }

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public String getFamilyId() {
        return familyId;
    }

    public String getToken() {
        return token;
    }

    public boolean isRevoked() {
        return revoked;
    }

    public void setRevoked(boolean revoked) {
        this.revoked = revoked;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getAbsoluteExpiresAt() {
        return absoluteExpiresAt;
    }
}
