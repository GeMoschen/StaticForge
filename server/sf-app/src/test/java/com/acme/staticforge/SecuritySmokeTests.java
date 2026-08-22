package com.acme.staticforge;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Verifies the stateless security skeleton (§9.5): unauthenticated API calls get a
 * RFC 9457 problem document, while the actuator health probe stays public.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecuritySmokeTests {

    @Autowired MockMvc mvc;

    @Test
    void unauthenticatedApiReturnsProblemDocument() throws Exception {
        mvc.perform(get("/api/v1/status"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.code").value("SF-API-0401"));
    }

    @Test
    void actuatorHealthIsPublic() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }
}
