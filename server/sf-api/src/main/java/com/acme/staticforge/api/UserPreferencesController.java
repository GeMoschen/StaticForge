package com.acme.staticforge.api;

import com.acme.staticforge.preferences.UserPreferencesService;
import com.acme.staticforge.security.SecuritySupport;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The signed-in user's preferences document (M35.3): a JSON object with a {@code schemaVersion}, capped at 64 KB
 * ({@code 413 SF-DOM-0133}; an invalid body or version is {@code 422 SF-DOM-0134}). There is no user id in the
 * path: everyone reads and writes only their own document. {@code PATCH} is an RFC 7386 JSON merge patch
 * ({@code application/json} or {@code application/merge-patch+json}); every call answers the full document.
 */
@RestController
@RequestMapping("/api/v1/me/preferences")
public class UserPreferencesController {

    private final UserPreferencesService preferences;
    private final SecuritySupport securitySupport;

    public UserPreferencesController(UserPreferencesService preferences, SecuritySupport securitySupport) {
        this.preferences = preferences;
        this.securitySupport = securitySupport;
    }

    @GetMapping
    public JsonNode get() {
        return preferences.get(securitySupport.currentUserId());
    }

    @PutMapping
    public JsonNode replace(@RequestBody JsonNode document) {
        return preferences.replace(securitySupport.currentUserId(), document);
    }

    @PatchMapping(consumes = {MediaType.APPLICATION_JSON_VALUE, "application/merge-patch+json"})
    public JsonNode patch(@RequestBody JsonNode mergePatch) {
        return preferences.patch(securitySupport.currentUserId(), mergePatch);
    }
}
