package com.acme.staticforge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.acme.staticforge.preferences.UserPreferencesRepository;
import com.acme.staticforge.security.JwtService;
import com.acme.staticforge.user.AppUser;
import com.acme.staticforge.user.AppUserRepository;
import com.acme.staticforge.user.SystemRole;
import com.acme.staticforge.user.UserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** The per-user preferences document (M35.3): get, replace, merge patch, size cap, validation, isolation, deletion. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class UserPreferencesApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String PASSWORD = "secret-password";
    private static final String URL = "/api/v1/me/preferences";
    private static final String MERGE_PATCH = "application/merge-patch+json";

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired UserService userService;
    @Autowired AppUserRepository users;
    @Autowired JwtService jwtService;
    @Autowired UserPreferencesRepository preferences;

    private AppUser newUser(String prefix) {
        int n = SEQ.incrementAndGet();
        return userService.create(
                "pf-" + prefix + "-" + n, "pf-" + prefix + "-" + n + "@example.com", "Pf " + prefix + " " + n, PASSWORD);
    }

    private String token(AppUser user) {
        return "Bearer " + jwtService.issueAccessToken(user);
    }

    private ResultActions getDoc(AppUser user) throws Exception {
        return mvc.perform(get(URL).header("Authorization", token(user)));
    }

    private ResultActions putDoc(AppUser user, String json) throws Exception {
        return mvc.perform(put(URL)
                .header("Authorization", token(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    private ResultActions patchDoc(AppUser user, String json, String contentType) throws Exception {
        return mvc.perform(patch(URL)
                .header("Authorization", token(user))
                .contentType(contentType)
                .content(json));
    }

    private ResultActions patchDoc(AppUser user, String json) throws Exception {
        return patchDoc(user, json, MediaType.APPLICATION_JSON_VALUE);
    }

    private JsonNode body(ResultActions actions) throws Exception {
        return objectMapper.readTree(actions.andReturn().getResponse().getContentAsString());
    }

    @Test
    void anAccountWithoutADocumentGetsTheDefault() throws Exception {
        AppUser user = newUser("default");
        getDoc(user).andExpect(status().isOk()).andExpect(jsonPath("$.schemaVersion").value(1));
        assertThat(preferences.findById(user.getId())).isEmpty();
    }

    @Test
    void putReplacesTheWholeDocumentAndDefaultsTheSchemaVersion() throws Exception {
        AppUser user = newUser("put");
        putDoc(user, "{\"theme\":\"dark\",\"density\":\"compact\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value(1))
                .andExpect(jsonPath("$.theme").value("dark"));
        putDoc(user, "{\"schemaVersion\":1,\"railCollapsed\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.theme").doesNotExist())
                .andExpect(jsonPath("$.density").doesNotExist())
                .andExpect(jsonPath("$.railCollapsed").value(true));
        JsonNode read = body(getDoc(user).andExpect(status().isOk()));
        assertThat(read.has("theme")).isFalse();
        assertThat(read.get("railCollapsed").asBoolean()).isTrue();
    }

    @Test
    void patchMergesRecursivelyAndNullRemovesAKey() throws Exception {
        AppUser user = newUser("patch");
        patchDoc(user, "{\"theme\":\"dark\",\"paneSizes\":{\"tree\":30,\"inspector\":20}}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value(1))
                .andExpect(jsonPath("$.paneSizes.tree").value(30));
        // The merge-patch content type is accepted too; nested objects merge, null deletes.
        JsonNode merged = body(patchDoc(
                        user,
                        "{\"paneSizes\":{\"tree\":null,\"preview\":50},\"density\":\"compact\",\"theme\":null}",
                        MERGE_PATCH)
                .andExpect(status().isOk()));
        assertThat(merged.has("theme")).isFalse();
        assertThat(merged.get("density").asText()).isEqualTo("compact");
        assertThat(merged.at("/paneSizes/tree").isMissingNode()).isTrue();
        assertThat(merged.at("/paneSizes/inspector").asInt()).isEqualTo(20);
        assertThat(merged.at("/paneSizes/preview").asInt()).isEqualTo(50);
        // A scalar replaces an object, and arrays replace wholesale.
        patchDoc(user, "{\"paneSizes\":1,\"recents\":[\"a\",\"b\"]}").andExpect(jsonPath("$.paneSizes").value(1));
        patchDoc(user, "{\"recents\":[\"c\"]}").andExpect(jsonPath("$.recents.length()").value(1));
        assertThat(body(getDoc(user)).get("density").asText()).isEqualTo("compact");
    }

    @Test
    void concurrentPatchesOfDisjointKeysKeepAllKeys() throws Exception {
        AppUser user = newUser("concurrent");
        int tabs = 8;
        ExecutorService pool = Executors.newFixedThreadPool(tabs);
        try {
            java.util.List<Future<?>> futures = new java.util.ArrayList<>();
            for (int i = 0; i < tabs; i++) {
                String json = "{\"key" + i + "\":" + i + "}";
                futures.add(pool.submit(() -> {
                    patchDoc(user, json).andExpect(status().isOk());
                    return null;
                }));
            }
            for (Future<?> f : futures) {
                f.get();
            }
        } finally {
            pool.shutdownNow();
        }
        JsonNode doc = body(getDoc(user));
        for (int i = 0; i < tabs; i++) {
            assertThat(doc.get("key" + i).asInt()).isEqualTo(i);
        }
    }

    @Test
    void aDocumentOverSixtyFourKilobytesIsRejectedWith413() throws Exception {
        AppUser user = newUser("big");
        String huge = "x".repeat(70_000);
        putDoc(user, "{\"blob\":\"" + huge + "\"}")
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("SF-DOM-0133"));
        patchDoc(user, "{\"blob\":\"" + huge + "\"}")
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("SF-DOM-0133"));
        // The cap applies to the merged result: two patches that are each small but add up are refused.
        String half = "y".repeat(40_000);
        patchDoc(user, "{\"a\":\"" + half + "\"}").andExpect(status().isOk());
        patchDoc(user, "{\"b\":\"" + half + "\"}")
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("SF-DOM-0133"));
        assertThat(body(getDoc(user)).has("b")).isFalse();
    }

    @Test
    void anInvalidBodyOrSchemaVersionIsRejectedWith422() throws Exception {
        AppUser user = newUser("invalid");
        for (String bad : new String[] {"[1,2]", "\"text\"", "42"}) {
            putDoc(user, bad).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("SF-DOM-0134"));
            patchDoc(user, bad).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("SF-DOM-0134"));
        }
        for (String version : new String[] {"0", "-1", "1.5", "\"1\"", "2", "true"}) {
            putDoc(user, "{\"schemaVersion\":" + version + "}")
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("SF-DOM-0134"));
            patchDoc(user, "{\"schemaVersion\":" + version + "}")
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("SF-DOM-0134"));
        }
        assertThat(body(getDoc(user)).get("schemaVersion").asInt()).isEqualTo(1);
    }

    @Test
    void everyUserOnlySeesTheirOwnDocument() throws Exception {
        AppUser alice = newUser("alice");
        AppUser bob = newUser("bob");
        putDoc(alice, "{\"theme\":\"dark\"}").andExpect(status().isOk());
        getDoc(bob).andExpect(status().isOk()).andExpect(jsonPath("$.theme").doesNotExist());
        patchDoc(bob, "{\"density\":\"compact\"}").andExpect(status().isOk());
        JsonNode aliceDoc = body(getDoc(alice));
        assertThat(aliceDoc.get("theme").asText()).isEqualTo("dark");
        assertThat(aliceDoc.has("density")).isFalse();
    }

    @Test
    void deletingTheAccountRemovesItsDocument() throws Exception {
        AppUser admin = newUser("admin");
        admin.setSystemRole(SystemRole.INSTANCE_ADMIN);
        users.save(admin);
        AppUser victim = newUser("victim");
        putDoc(victim, "{\"theme\":\"dark\"}").andExpect(status().isOk());
        assertThat(preferences.findById(victim.getId())).isPresent();

        mvc.perform(delete("/api/v1/admin/users/" + victim.getId() + "?confirm=" + victim.getUsername())
                        .header("Authorization", token(admin)))
                .andExpect(status().isNoContent());

        assertThat(preferences.findById(victim.getId())).isEmpty();
    }

    @Test
    void anonymousCallsAreUnauthorized() throws Exception {
        mvc.perform(get(URL)).andExpect(status().isUnauthorized());
        mvc.perform(put(URL).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(patch(URL).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void anAccountThatMustChangeItsPasswordIsBlockedLikeOtherEndpoints() throws Exception {
        AppUser user = newUser("mustchange");
        user.setMustChangePassword(true);
        users.save(user);
        getDoc(user).andExpect(status().is(428));
    }
}
