package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.ChangePasswordRequest;
import com.acme.staticforge.api.dto.LoginRequest;
import com.acme.staticforge.api.dto.LoginResponse;
import com.acme.staticforge.api.dto.MeResponse;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import com.acme.staticforge.security.AuthService;
import com.acme.staticforge.security.AuthenticatedUser;
import com.acme.staticforge.security.JwtProperties;
import com.acme.staticforge.security.RefreshCookieService;
import com.acme.staticforge.security.SecuritySupport;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
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

    public AuthController(
            AuthService authService,
            RefreshCookieService cookies,
            SecuritySupport securitySupport,
            JwtProperties jwtProperties) {
        this.authService = authService;
        this.cookies = cookies;
        this.securitySupport = securitySupport;
        this.jwtProperties = jwtProperties;
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
        AuthenticatedUser user = securitySupport.requireUser();
        Map<String, String> projectRoles = new LinkedHashMap<>();
        user.projectRoles().forEach((key, role) -> projectRoles.put(key, role.name()));
        return new MeResponse(
                user.id(), user.username(), user.displayName(), user.systemRole().name(), projectRoles);
    }

    @PostMapping("/password")
    public ResponseEntity<Void> changePassword(@Valid @RequestBody ChangePasswordRequest body) {
        AuthenticatedUser user = securitySupport.requireUser();
        authService.changePassword(user, body.currentPassword(), body.newPassword());
        return ResponseEntity.noContent().build();
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
