package com.acme.staticforge;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

/** {@code sf.security.password.*} (M26.1.1/M26.1.3): the configured rules are served and enforced. */
@SpringBootTest(properties = {"sf.security.password.min-length=16", "sf.security.password.require-mixed=true"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ConfiguredPasswordPolicyIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired UserService userService;
    @Autowired JwtService jwtService;

    @Test
    void servesAndEnforcesTheConfiguredRules() throws Exception {
        mvc.perform(get("/api/v1/auth/password-policy"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.minLength").value(16))
                .andExpect(jsonPath("$.requireMixed").value(true))
                .andExpect(jsonPath("$.maxBytes").value(72));

        AppUser user = userService.create("policy-user", "policy-user@example.com", null, "secret-password");
        String bearer = "Bearer " + jwtService.issueAccessToken(user);

        mvc.perform(post("/api/v1/auth/password")
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"secret-password\",\"newPassword\":\"onlylettershere\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0]").value("Password must be at least 16 characters long."))
                .andExpect(jsonPath("$.errors[1]").value("Password must contain at least one digit or symbol."));
        mvc.perform(post("/api/v1/auth/password")
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"secret-password\",\"newPassword\":\"letters-and-4-more\"}"))
                .andExpect(status().isNoContent());
    }
}
