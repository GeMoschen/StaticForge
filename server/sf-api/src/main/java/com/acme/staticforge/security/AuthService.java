package com.acme.staticforge.security;

import com.acme.staticforge.audit.AuditService;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.PasswordService;
import com.acme.staticforge.user.UserService;
import com.acme.staticforge.user.UserStatus;
import java.time.Clock;
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
        if (user.getStatus() == UserStatus.DISABLED) {
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
        String accessToken = jwtService.issueAccessToken(user);
        return new RefreshResult(accessToken, refreshed.getToken());
    }

    public void logout(String presentedToken) {
        refreshTokenService.revokeFamily(presentedToken);
    }

    public void changePassword(AuthenticatedUser principal, String currentPassword, String newPassword) {
        AppUser user = userService.requireById(principal.id());
        if (!passwordService.matches(currentPassword, user.getPasswordHash())) {
            throw new SfException(ProblemFactory.badRequest("Current password is incorrect."));
        }
        userService.changePassword(user.getId(), newPassword);
        userService.bumpTokenEpoch(user.getId());
        refreshTokenService.revokeAll(user.getId());
    }

    private static SfException invalidCredentials() {
        return new SfException(ProblemFactory.unauthorized("Invalid username or password."));
    }
}
