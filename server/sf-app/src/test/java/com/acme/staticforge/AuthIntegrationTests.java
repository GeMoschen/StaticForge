package com.acme.staticforge;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * End-to-end authentication flow (§9.4). A login returns an access token (JSON body) and an
 * {@code HttpOnly; Secure; SameSite=Strict} refresh cookie; the access token authorizes a
 * protected endpoint through the full JWT resource-server chain; and bad credentials yield a
 * 401 problem document.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthIntegrationTests {

    @Autowired MockMvc mvc;

    @Autowired UserService userService;

    @Autowired JwtService jwtService;

    @Test
    void loginReturnsAccessTokenAndHttpOnlyRefreshCookie() throws Exception {
        userService.create("alice", "alice@example.com", "Alice", "secret-password");

        mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"alice\",\"password\":\"secret-password\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(header().string("Set-Cookie", containsString("HttpOnly")))
                .andExpect(header().string("Set-Cookie", containsString("SameSite=Strict")))
                .andExpect(header().string("Set-Cookie", containsString("Path=/api/v1/auth")));
    }

    @Test
    void accessTokenAuthorizesProtectedEndpoint() throws Exception {
        AppUser bob = userService.create("bob", "bob@example.com", "Bob", "secret-password");

        String accessToken = jwtService.issueAccessToken(bob);

        mvc.perform(get("/api/v1/status").header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"));
    }

    @Test
    void wrongPasswordReturns401Problem() throws Exception {
        userService.create("carol", "carol@example.com", "Carol", "secret-password");

        mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"carol\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.code").value("SF-API-0401"));
    }

    @Test
    void meReturnsAuthenticatedPrincipal() throws Exception {
        AppUser dave = userService.create("dave", "dave@example.com", "Dave", "secret-password");

        String accessToken = jwtService.issueAccessToken(dave);

        mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(dave.getId()))
                .andExpect(jsonPath("$.username").value("dave"))
                .andExpect(jsonPath("$.displayName").value("Dave"))
                .andExpect(jsonPath("$.systemRole").value("USER"));
    }

    @Test
    void passwordChangeRejectsPreviouslyIssuedTokens() throws Exception {
        AppUser erin = userService.create("erin", "erin@example.com", "Erin", "secret-password");

        String accessToken = jwtService.issueAccessToken(erin);

        mvc.perform(post("/api/v1/auth/password")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"secret-password\",\"newPassword\":\"new-secret-password\"}"))
                .andExpect(status().isNoContent());

        // The old token's epoch no longer matches after bumpTokenEpoch, so it is rejected.
        mvc.perform(get("/api/v1/status").header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isUnauthorized());
    }
}
