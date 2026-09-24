package com.acme.staticforge.security;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.Set;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.CsrfConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;

/**
 * Stateless security posture (spec §9.5). CSRF is disabled for the Bearer-authenticated API,
 * sessions are stateless, and failures are returned as {@code application/problem+json}. The
 * auth endpoints are wired to the JWT resource server via {@link SfJwtAuthenticationConverter}.
 *
 * <p>TODO(spec §9.3): RS256 + JWKS + two-key rotation is a documented follow-up. Only HS256 is
 * implemented here; when no shared secret is configured (e.g. {@code prod}) we fall back to a
 * placeholder key so the context still boots, but no real tokens are issued or accepted.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@EnableConfigurationProperties(JwtProperties.class)
public class SecurityConfig {

    private static final Logger LOG = LoggerFactory.getLogger(SecurityConfig.class);

    /** Reachable without a session; they authenticate by password or refresh cookie, if at all. */
    private static final Set<String> PUBLIC_AUTH_ENDPOINTS =
            Set.of("/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/password-policy");

    private static final String PLACEHOLDER_SECRET = "staticforge-deferred-rs256-not-for-production";

    @Bean
    @Order(1)
    public SecurityFilterChain api(
            HttpSecurity http,
            ObjectMapper objectMapper,
            JwtDecoder jwtDecoder,
            SfJwtAuthenticationConverter jwtAuthenticationConverter)
            throws Exception {
        return http.securityMatcher("/api/**")
                .csrf(CsrfConfigurer::disable)
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Default is DENY; PreviewController serves signed share links meant to be framed
                // by the app's own preview iframe (spec §19.3) and sets its own X-Frame-Options —
                // but Spring MVC applies ResponseEntity headers via HttpServletResponse#addHeader
                // (append), not #setHeader (replace), so a controller-level header lands *alongside*
                // this filter's default rather than overriding it. Two X-Frame-Options values with
                // different verdicts on the same response makes browsers refuse the frame outright
                // (observed as "X-Frame-Options set to 'deny'" even though the controller asked for
                // SAMEORIGIN). Setting the one true default here, instead of fighting it per-controller,
                // avoids the duplicate header entirely.
                .headers(h -> h.frameOptions(frame -> frame.sameOrigin()))
                .authorizeHttpRequests(a -> a.requestMatchers(
                                PUBLIC_AUTH_ENDPOINTS.toArray(String[]::new))
                        .permitAll()
                        .requestMatchers("/api/v1/auth/**")
                        .authenticated()
                        // Signed, expiring share-token route (spec §19.3) — the token itself is the
                        // credential (verified in PreviewController#share), so this must be reachable
                        // without a Bearer session; filter-chain authorization runs before method-level
                        // @PreAuthorize, so permitAll() there alone can never take effect.
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/v1/projects/*/preview/share")
                        .permitAll()
                        // Same reasoning, for MEDIA references inside that same rendered preview HTML —
                        // see MediaController#shareBinary.
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/v1/projects/*/media/*/share")
                        .permitAll()
                        .anyRequest()
                        .authenticated())
                .oauth2ResourceServer(o -> o.bearerTokenResolver(publicAuthEndpointsIgnoreBearer())
                        .jwt(j -> j.decoder(jwtDecoder).jwtAuthenticationConverter(jwtAuthenticationConverter)))
                // A pending forced password change (M26) blocks everything but its allowlist; it needs the
                // authenticated principal, so it runs right after bearer authentication.
                .addFilterAfter(new PasswordChangeRequiredFilter(objectMapper), BearerTokenAuthenticationFilter.class)
                .exceptionHandling(e -> e.authenticationEntryPoint((request, response, authException) ->
                                writeProblem(response, objectMapper, ProblemFactory.unauthorized("Authentication required.")))
                        .accessDeniedHandler((request, response, accessDeniedException) ->
                                writeProblem(response, objectMapper, ProblemFactory.forbidden("Access denied."))))
                .build();
    }

    /**
     * Login, refresh and the password policy authenticate by password or refresh cookie, never by access token: a
     * bearer header on them is ignored. Otherwise a token revoked by an epoch bump (a membership change, M26) would get
     * the very refresh that is meant to replace it refused with {@code 401}.
     */
    static BearerTokenResolver publicAuthEndpointsIgnoreBearer() {
        DefaultBearerTokenResolver bearer = new DefaultBearerTokenResolver();
        return request -> {
            String path = request.getRequestURI().substring(request.getContextPath().length());
            return PUBLIC_AUTH_ENDPOINTS.contains(path) ? null : bearer.resolve(request);
        };
    }

    @Bean
    @Order(2)
    public SecurityFilterChain actuator(HttpSecurity http) throws Exception {
        return http.securityMatcher(
                        "/actuator/**",
                        "/.well-known/**",
                        "/v3/api-docs/**",
                        "/swagger-ui/**",
                        "/swagger-ui.html")
                .csrf(CsrfConfigurer::disable)
                .authorizeHttpRequests(a -> a.anyRequest().permitAll())
                .build();
    }

    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    public JwtEncoder jwtEncoder(JwtProperties properties) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(hmacKey(properties)));
    }

    @Bean
    public JwtDecoder jwtDecoder(JwtProperties properties) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(hmacKey(properties))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        if (properties.getIssuer() != null && !properties.getIssuer().isBlank()) {
            decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(properties.getIssuer()));
        }
        return decoder;
    }

    private static SecretKey hmacKey(JwtProperties properties) {
        String secret = properties.getSecret();
        if (secret == null || secret.isBlank()) {
            LOG.warn(
                    "No sf.security.jwt.secret configured and algorithm is {}; RS256/JWKS signing is not yet "
                            + "implemented, so a placeholder HS256 key is used and no real tokens will be accepted.",
                    properties.getAlgorithm());
            secret = PLACEHOLDER_SECRET;
        }
        return new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    private static void writeProblem(HttpServletResponse response, ObjectMapper mapper, Problem problem)
            throws java.io.IOException {
        response.setStatus(problem.getStatus());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(mapper.writeValueAsString(problem));
    }
}
