package com.acme.staticforge.generate.quality;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/**
 * A project's quality rule configuration as a build applies it (M30, epic decision 4): every registered rule's
 * severity and parameter values — the registry's defaults overlaid with what the project stored. Immutable.
 */
public final class EffectiveQualityConfig {

    /**
     * One rule's setting.
     *
     * @param severity the configured severity (before the rule's {@link QualityRule#maxSeverity() cap})
     * @param params every parameter's value by name: {@link Integer} or {@link Boolean}
     */
    public record RuleSetting(QualitySeverity severity, Map<String, Object> params) {

        public RuleSetting {
            Objects.requireNonNull(severity, "severity");
            params = params == null ? Map.of() : Map.copyOf(params);
        }
    }

    private final QualityRuleRegistry registry;
    private final Map<String, RuleSetting> settings;

    private EffectiveQualityConfig(QualityRuleRegistry registry, Map<String, RuleSetting> settings) {
        this.registry = registry;
        this.settings = settings;
    }

    /** Every rule at its defaults. */
    public static EffectiveQualityConfig defaults(QualityRuleRegistry registry) {
        return of(registry, Map.of());
    }

    /**
     * The defaults overlaid with {@code overrides}: a code the registry doesn't know is dropped (a rule removed in a
     * later version doesn't break a project), a parameter the rule doesn't have or a value it doesn't accept keeps its
     * default. Validation that reports these belongs to the write path.
     *
     * <p>Parameter values that don't fit together ({@link QualityRule#paramsProblem}) are all replaced by the defaults.
     *
     * @param overrides by code; a setting's params may name only some parameters, the rest keep their defaults
     */
    public static EffectiveQualityConfig of(QualityRuleRegistry registry, Map<String, RuleSetting> overrides) {
        Map<String, RuleSetting> settings = new TreeMap<>();
        for (QualityRule rule : registry.all()) {
            RuleSetting override = overrides.get(rule.code());
            Map<String, Object> params = new LinkedHashMap<>();
            for (RuleParam param : rule.params()) {
                Object value = override == null ? null : override.params().get(param.name());
                params.put(param.name(), value != null && param.problemWith(value) == null ? value : param.defaultValue());
            }
            if (rule.paramsProblem(params) != null) {
                // Values that don't fit together (a stored range with min above max) all fall back to the defaults.
                params.clear();
                rule.params().forEach(param -> params.put(param.name(), param.defaultValue()));
            }
            QualitySeverity severity = override == null ? rule.defaultSeverity() : override.severity();
            settings.put(rule.code(), new RuleSetting(severity, params));
        }
        return new EffectiveQualityConfig(registry, settings);
    }

    public QualityRuleRegistry registry() {
        return registry;
    }

    /** The configured setting of {@code code}; {@code null} for a code the registry doesn't know. */
    public RuleSetting setting(String code) {
        return settings.get(code);
    }

    /** Every rule's setting by code, in code order. */
    public Map<String, RuleSetting> settings() {
        return settings;
    }

    /** The severity {@code rule}'s findings get: the configured one, capped at the rule's maximum. */
    public QualitySeverity severity(QualityRule rule) {
        RuleSetting setting = settings.get(rule.code());
        QualitySeverity configured = setting == null ? rule.defaultSeverity() : setting.severity();
        return configured.cappedAt(rule.maxSeverity());
    }

    /** Whether {@code rule} runs at all. */
    public boolean enabled(QualityRule rule) {
        return severity(rule) != QualitySeverity.OFF;
    }

    /** The severity of the rule with {@code code}; {@code OFF} for a code the registry doesn't know. */
    public QualitySeverity severity(String code) {
        return registry.find(code).map(this::severity).orElse(QualitySeverity.OFF);
    }

    /** {@code rule}'s parameter values by name. */
    public Map<String, Object> params(QualityRule rule) {
        RuleSetting setting = settings.get(rule.code());
        return setting == null ? Map.of() : setting.params();
    }

    /**
     * A digest of every rule's effective severity and parameters (SHA-256, hex): equal for two configurations exactly
     * when every rule behaves the same. Recorded in a build's sidecar (M30.1.3).
     */
    public String fingerprint() {
        StringBuilder text = new StringBuilder();
        for (QualityRule rule : registry.all()) {
            text.append(rule.code()).append('=').append(severity(rule));
            new TreeMap<>(params(rule)).forEach((name, value) -> text.append(';').append(name).append('=').append(value));
            text.append('\n');
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(text.toString().getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
