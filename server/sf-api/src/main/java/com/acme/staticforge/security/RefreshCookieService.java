package com.acme.staticforge.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.util.Optional;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * Builds and reads the refresh-token cookie. The cookie is {@code HttpOnly; Secure;
 * SameSite=Strict} with path {@code /api/v1/auth} (spec §9.1, §9.4), keeping it unreachable
 * to JavaScript and scoped to the auth endpoints.
 */
@Component
public class RefreshCookieService {

    public static final String COOKIE_NAME = "sf_refresh_token";
    private static final String COOKIE_PATH = "/api/v1/auth";

    private final JwtProperties properties;

    public RefreshCookieService(JwtProperties properties) {
        this.properties = properties;
    }

    public ResponseCookie create(String token) {
        return base().maxAge(properties.getRefreshTokenAbsoluteTtl()).value(token).build();
    }

    public ResponseCookie clear() {
        return base().maxAge(Duration.ZERO).value("").build();
    }

    public Optional<String> read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        for (Cookie cookie : cookies) {
            if (COOKIE_NAME.equals(cookie.getName())
                    && cookie.getValue() != null
                    && !cookie.getValue().isBlank()) {
                return Optional.of(cookie.getValue());
            }
        }
        return Optional.empty();
    }

    private static ResponseCookie.ResponseCookieBuilder base() {
        return ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .secure(true)
                .sameSite("Strict")
                .path(COOKIE_PATH);
    }
}
