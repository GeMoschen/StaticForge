package com.acme.staticforge.security;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
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
import org.springframework.security.web.SecurityFilterChain;

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
                .authorizeHttpRequests(a -> a.requestMatchers("/api/v1/auth/login", "/api/v1/auth/refresh")
                        .permitAll()
                        .requestMatchers("/api/v1/auth/**")
                        .authenticated()
                        .anyRequest()
                        .authenticated())
                .oauth2ResourceServer(o -> o.jwt(j -> j.decoder(jwtDecoder)
                        .jwtAuthenticationConverter(jwtAuthenticationConverter)))
                .exceptionHandling(e -> e.authenticationEntryPoint((request, response, authException) ->
                                writeProblem(response, objectMapper, ProblemFactory.unauthorized("Authentication required.")))
                        .accessDeniedHandler((request, response, accessDeniedException) ->
                                writeProblem(response, objectMapper, ProblemFactory.forbidden("Access denied."))))
                .build();
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
