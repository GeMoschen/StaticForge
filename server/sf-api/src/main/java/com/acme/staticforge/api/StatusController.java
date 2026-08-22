package com.acme.staticforge.api;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Minimal protected endpoint used to smoke-test the security skeleton and to exercise
 * OpenAPI generation (spec §4.2 "API contract").
 */
@RestController
@RequestMapping("/api/v1/status")
public class StatusController {

    private final String version;

    public StatusController(@Value("${info.app.version:unknown}") String version) {
        this.version = version;
    }

    @GetMapping
    public Map<String, Object> status() {
        return Map.of("status", "ok", "version", version);
    }
}
