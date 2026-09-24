package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChangePasswordRequest;
import com.acme.staticforge.api.dto.LoginRequest;
import com.acme.staticforge.api.dto.LoginResponse;
import com.acme.staticforge.api.dto.MeResponse;
import com.acme.staticforge.api.dto.PasswordPolicyView;
import com.acme.staticforge.api.dto.UpdateMeRequest;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.security.AuthService;
import com.acme.staticforge.security.AuthenticatedUser;
import com.acme.staticforge.security.JwtProperties;
import com.acme.staticforge.security.RefreshCookieService;
import com.acme.staticforge.security.SecuritySupport;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.PasswordPolicy;
import com.acme.staticforge.user.UserAdministrationService;
import com.acme.staticforge.user.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Authentication endpoints (spec §9.4). No business logic lives here: it delegates to
 * {@link AuthService} and only handles the HTTP/cookie concerns.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;
    private final RefreshCookieService cookies;
    private final SecuritySupport securitySupport;
    private final JwtProperties jwtProperties;
    private final UserService userService;
    private final UserAdministrationService userAdministration;
    private final PasswordPolicy passwordPolicy;

    public AuthController(
            AuthService authService,
            RefreshCookieService cookies,
            SecuritySupport securitySupport,
            JwtProperties jwtProperties,
            UserService userService,
            UserAdministrationService userAdministration,
            PasswordPolicy passwordPolicy) {
        this.authService = authService;
        this.cookies = cookies;
        this.securitySupport = securitySupport;
        this.jwtProperties = jwtProperties;
        this.userService = userService;
        this.userAdministration = userAdministration;
        this.passwordPolicy = passwordPolicy;
    }

    @PostMapping("/login")
    public LoginResponse login(
            @Valid @RequestBody LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
        AuthService.LoginResult result = authService.login(body.username(), body.password(), clientIp(request));
        setRefreshCookie(response, result.refreshToken());
        return new LoginResponse(result.accessToken(), "Bearer", accessTtlSeconds());
    }

    @PostMapping("/refresh")
    public LoginResponse refresh(HttpServletRequest request, HttpServletResponse response) {
        String xRequestedWith = request.getHeader("X-Requested-With");
        if (xRequestedWith == null || xRequestedWith.isBlank()) {
            throw new SfException(ProblemFactory.unauthorized("Missing X-Requested-With header."));
        }
        String presentedToken = cookies.read(request)
                .orElseThrow(() -> new SfException(ProblemFactory.unauthorized("Missing refresh token.")));
        AuthService.RefreshResult result = authService.refresh(presentedToken);
        setRefreshCookie(response, result.refreshToken());
        return new LoginResponse(result.accessToken(), "Bearer", accessTtlSeconds());
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        cookies.read(request).ifPresent(authService::logout);
        response.addHeader(HttpHeaders.SET_COOKIE, cookies.clear().toString());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public MeResponse me() {
        AuthenticatedUser principal = securitySupport.requireUser();
        return toMe(principal, userService.requireById(principal.id()));
    }

    /** Self-service profile edit (M26); answers the updated profile so the client needs no second read. */
    @PatchMapping("/me")
    public MeResponse updateMe(@RequestBody UpdateMeRequest body) {
        AuthenticatedUser principal = securitySupport.requireUser();
        AppUser user = authService.updateProfile(
                principal,
                new UserService.ProfileUpdate(body.username(), body.email(), body.displayName()),
                body.currentPassword());
        return toMe(principal, user);
    }

    /** Sign out everywhere (M26), this session included: every token of the account stops working. */
    @PostMapping("/sessions/revoke")
    public ResponseEntity<Void> revokeSessions(HttpServletResponse response) {
        authService.revokeAllSessions(securitySupport.requireUser());
        response.addHeader(HttpHeaders.SET_COOKIE, cookies.clear().toString());
        return ResponseEntity.noContent().build();
    }

    /** The rules a new password must meet (M26); public, so a client can show them before anyone signs in. */
    @GetMapping("/password-policy")
    public PasswordPolicyView passwordPolicy() {
        return new PasswordPolicyView(passwordPolicy.minLength(), passwordPolicy.requireMixed(), PasswordPolicy.MAX_BYTES);
    }

    @PostMapping("/password")
    public ResponseEntity<Void> changePassword(@Valid @RequestBody ChangePasswordRequest body) {
        AuthenticatedUser user = securitySupport.requireUser();
        authService.changePassword(user, body.currentPassword(), body.newPassword());
        return ResponseEntity.noContent().build();
    }

    private MeResponse toMe(AuthenticatedUser principal, AppUser user) {
        Map<String, String> projectRoles = new LinkedHashMap<>();
        principal.projectRoles().forEach((key, role) -> projectRoles.put(key, role.name()));
        boolean instanceAdmin = principal.isInstanceAdmin();
        List<MeResponse.Membership> memberships = userAdministration.memberships(user.getId()).stream()
                // Archived projects are hidden from everyone but instance admins (M26), like GET /projects.
                .filter(m -> instanceAdmin || !m.archived())
                .map(m -> new MeResponse.Membership(m.projectKey(), m.projectName(), m.role().name()))
                .toList();
        return new MeResponse(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getEmail(),
                user.getSystemRole().name(),
                user.isMustChangePassword(),
                projectRoles,
                memberships);
    }

    private long accessTtlSeconds() {
        return jwtProperties.getAccessTokenTtl().toSeconds();
    }

    private void setRefreshCookie(HttpServletResponse response, String token) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookies.create(token).toString());
    }

    private static String clientIp(HttpServletRequest request) {
        return request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
    }
}
