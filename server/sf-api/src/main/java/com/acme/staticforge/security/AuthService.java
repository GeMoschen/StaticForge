package com.acme.staticforge.security;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.PasswordService;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.time.Clock;
import java.util.Objects;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * Orchestrates the auth flows (spec §9.4). Controllers delegate here; this service keeps
 * the actual credential checks, lockout, token issuance and refresh rotation in one place.
 */
@Service
public class AuthService {

    private final UserService userService;
    private final PasswordService passwordService;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokenService;
    private final LoginAttemptService loginAttemptService;
    private final AuditService auditService;
    private final Clock clock;

    public AuthService(
            UserService userService,
            PasswordService passwordService,
            JwtService jwtService,
            RefreshTokenService refreshTokenService,
            LoginAttemptService loginAttemptService,
            AuditService auditService,
            Clock clock) {
        this.userService = userService;
        this.passwordService = passwordService;
        this.jwtService = jwtService;
        this.refreshTokenService = refreshTokenService;
        this.loginAttemptService = loginAttemptService;
        this.auditService = auditService;
        this.clock = clock;
    }

    public record LoginResult(String accessToken, String refreshToken) {}

    public record RefreshResult(String accessToken, String refreshToken) {}

    public LoginResult login(String username, String password, String clientIp) {
        String rateKey = clientIp + ":" + username;
        loginAttemptService.checkRateLimit(rateKey);

        Optional<AppUser> found = userService.findByUsername(username);
        if (found.isEmpty()) {
            loginAttemptService.recordIpFailure(rateKey);
            auditService.record(null, null, "AUTH_LOGIN_FAILED", "user:" + username);
            throw invalidCredentials();
        }
        AppUser user = found.get();

        if (user.getLockedUntil() != null && user.getLockedUntil().isAfter(clock.instant())) {
            throw new SfException(ProblemFactory.other(
                    423, "SF-API-0423", "Locked", "Account is temporarily locked; try again later."));
        }
        if (user.getStatus() == UserStatus.DISABLED || user.getStatus() == UserStatus.DELETED) {
            loginAttemptService.recordIpFailure(rateKey);
            auditService.record(null, user.getId(), "AUTH_LOGIN_FAILED", "user:" + username);
            throw invalidCredentials();
        }

        if (!passwordService.matches(password, user.getPasswordHash())) {
            loginAttemptService.recordIpFailure(rateKey);
            loginAttemptService.registerAccountFailure(user);
            auditService.record(null, user.getId(), "AUTH_LOGIN_FAILED", "user:" + username);
            throw invalidCredentials();
        }

        loginAttemptService.recordIpSuccess(rateKey);
        loginAttemptService.registerAccountSuccess(user);
        auditService.record(null, user.getId(), "AUTH_LOGIN", "user:" + user.getUsername());

        String accessToken = jwtService.issueAccessToken(user);
        RefreshToken refreshToken = refreshTokenService.issue(user.getId());
        return new LoginResult(accessToken, refreshToken.getToken());
    }

    public RefreshResult refresh(String presentedToken) {
        RefreshToken refreshed = refreshTokenService.rotate(presentedToken);
        AppUser user = userService.requireById(refreshed.getUserId());
        if (user.getStatus() == UserStatus.DISABLED || user.getStatus() == UserStatus.DELETED) {
            // Disable and delete revoke every family already; this drops one that slipped through (e.g. issued
            // concurrently) instead of handing a disabled account a fresh token.
            refreshTokenService.revokeFamily(refreshed.getToken());
            throw new SfException(ProblemFactory.unauthorized("Account is disabled; please contact an administrator."));
        }
        String accessToken = jwtService.issueAccessToken(user);
        return new RefreshResult(accessToken, refreshed.getToken());
    }

    public void logout(String presentedToken) {
        refreshTokenService.revokeFamily(presentedToken);
    }

    public void changePassword(AuthenticatedUser principal, String currentPassword, String newPassword) {
        AppUser user = userService.requireById(principal.id());
        if (!passwordService.matches(currentPassword, user.getPasswordHash())) {
            throw new SfException(ProblemFactory.badRequest("Current password is incorrect.", "currentPassword"));
        }
        userService.changePassword(user.getId(), newPassword);
        userService.revokeAccess(user.getId());
        refreshTokenService.revokeAll(user.getId());
        auditService.record(
                null, user.getId(), "USER_PASSWORD_CHANGED", "user:" + user.getUsername(), UserService.userDetail(user.getId()));
    }

    /**
     * Self-service profile edit (M26). Changing the username or email needs the current password ({@code 400} when
     * missing or wrong); the display name does not. Audited with the user as actor; sessions stay valid.
     */
    public AppUser updateProfile(AuthenticatedUser principal, UserService.ProfileUpdate update, String currentPassword) {
        AppUser user = userService.requireById(principal.id());
        boolean renames = update.username() != null && !update.username().trim().equals(user.getUsername());
        boolean changesEmail = update.email() != null && !Objects.equals(update.email().trim(), user.getEmail());
        if (renames || changesEmail) {
            if (currentPassword == null || currentPassword.isEmpty()) {
                throw new SfException(ProblemFactory.badRequest(
                        "Enter your current password to change your username or email.", "currentPassword"));
            }
            if (!passwordService.matches(currentPassword, user.getPasswordHash())) {
                throw new SfException(ProblemFactory.badRequest("Current password is incorrect.", "currentPassword"));
            }
        }
        userService.updateProfile(user.getId(), update, user.getId());
        return userService.requireById(user.getId());
    }

    /**
     * Sign out everywhere (M26): every refresh-token family of the user — the current one included — is dropped and
     * every access token revoked. The caller clears the refresh cookie.
     */
    public void revokeAllSessions(AuthenticatedUser principal) {
        AppUser user = userService.requireById(principal.id());
        userService.revokeAccess(user.getId());
        refreshTokenService.revokeAll(user.getId());
        auditService.record(
                null, user.getId(), "USER_SESSIONS_REVOKED", "user:" + user.getUsername(), UserService.userDetail(user.getId()));
    }

    private static SfException invalidCredentials() {
        return new SfException(ProblemFactory.unauthorized("Invalid username or password."));
    }
}
