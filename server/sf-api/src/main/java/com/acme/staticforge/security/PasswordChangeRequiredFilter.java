package com.acme.staticforge.security;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Enforces a pending forced password change (M26): while the authenticated account has {@code mustChangePassword},
 * every API call answers {@code 428 SF-API-0428} except exactly the calls a client needs to get out of that state —
 * read the profile, change the password, refresh, sign out and read the password rules. Runs after bearer
 * authentication; unauthenticated requests pass through to the normal authorization rules.
 *
 * <p>Deliberately not a {@code @Component}: Spring Boot would register a filter bean on the servlet container as
 * well, outside the security chain. {@link SecurityConfig} adds it to the API chain only.
 */
public class PasswordChangeRequiredFilter extends OncePerRequestFilter {

    /** {@code METHOD path} pairs reachable while a password change is pending. */
    static final Set<String> ALLOWED = Set.of(
            "GET /api/v1/auth/me",
            "POST /api/v1/auth/password",
            "POST /api/v1/auth/logout",
            "POST /api/v1/auth/refresh",
            "GET /api/v1/auth/password-policy");

    private final ObjectMapper objectMapper;

    public PasswordChangeRequiredFilter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null
                && auth.getPrincipal() instanceof AuthenticatedUser user
                && user.mustChangePassword()
                && !ALLOWED.contains(request.getMethod() + " " + pathOf(request))) {
            Problem problem = ProblemFactory.other(
                    428,
                    "SF-API-0428",
                    "Password change required",
                    "Set a new password before using the API (POST /api/v1/auth/password).");
            response.setStatus(problem.getStatus());
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write(objectMapper.writeValueAsString(problem));
            return;
        }
        chain.doFilter(request, response);
    }

    private static String pathOf(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String contextPath = request.getContextPath();
        return contextPath != null && !contextPath.isEmpty() && uri.startsWith(contextPath)
                ? uri.substring(contextPath.length())
                : uri;
    }
}
