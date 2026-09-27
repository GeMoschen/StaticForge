package com.acme.staticforge.generate.quality;

import com.acme.staticforge.generate.quality.EffectiveQualityConfig.RuleSetting;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/**
 * The stored form of a project's quality rule configuration (M30, epic decision 4):
 * {@code {"rules": {"SF-CHK-0202": {"severity": "ERROR", "params": {"max": 70}}}}}, holding only what differs from a
 * rule's default. Reading is lenient (a code, severity or parameter this build doesn't know is dropped: a rule removed
 * in a later version doesn't break a project); {@link #validate} is the strict check of the write path.
 */
public final class QualityRuleConfig {

    private QualityRuleConfig() {}

    /**
     * One rule's entry as a client sent it.
     *
     * @param severity {@code OFF}, {@code WARNING} or {@code ERROR}; {@code null} keeps the rule's default
     * @param params parameter values by name as parsed from JSON ({@code null} keeps every default)
     */
    public record Entry(String severity, Map<String, Object> params) {}

    /** The validated configuration, or one message per invalid entry. */
    public record Validation(Map<String, RuleSetting> settings, List<String> errors) {

        public boolean valid() {
            return errors.isEmpty();
        }
    }

    /**
     * Validates a whole configuration: every code must be a registered rule, every severity one of
     * {@code OFF|WARNING|ERROR}, every parameter one the rule declares with a value within its bounds. Codes missing from
     * {@code entries} are at their defaults.
     */
    public static Validation validate(QualityRuleRegistry registry, Map<String, Entry> entries) {
        Map<String, RuleSetting> settings = new TreeMap<>();
        List<String> errors = new ArrayList<>();
        for (Map.Entry<String, Entry> item : (entries == null ? Map.<String, Entry>of() : entries).entrySet()) {
            String code = item.getKey();
            QualityRule rule = registry.find(code).orElse(null);
            if (rule == null) {
                errors.add(code + ": unknown rule.");
                continue;
            }
            Entry entry = item.getValue() == null ? new Entry(null, null) : item.getValue();
            QualitySeverity severity = rule.defaultSeverity();
            if (entry.severity() != null) {
                severity = QualitySeverity.parse(entry.severity());
                if (severity == null) {
                    errors.add(code + ": severity must be one of OFF, WARNING, ERROR.");
                    continue;
                }
            }
            Map<String, Object> params = new LinkedHashMap<>();
            boolean paramsValid = true;
            Map<String, Object> given = entry.params() == null ? Map.of() : entry.params();
            for (Map.Entry<String, Object> param : given.entrySet()) {
                RuleParam declared = rule.params().stream()
                        .filter(p -> p.name().equals(param.getKey()))
                        .findFirst()
                        .orElse(null);
                if (declared == null) {
                    errors.add(code + ": unknown parameter '" + param.getKey() + "'.");
                    paramsValid = false;
                    continue;
                }
                Object value = normalize(param.getValue());
                String problem = declared.problemWith(value);
                if (problem != null) {
                    errors.add(code + ": " + param.getKey() + " " + problem + ".");
                    paramsValid = false;
                    continue;
                }
                params.put(declared.name(), value);
            }
            if (paramsValid) {
                settings.put(code, new RuleSetting(severity, params));
            }
        }
        return new Validation(settings, errors);
    }

    /** JSON numbers arrive as Integer, Long or Double: an integral value within int range becomes an Integer. */
    private static Object normalize(Object value) {
        if (value instanceof Long number && number >= Integer.MIN_VALUE && number <= Integer.MAX_VALUE) {
            return number.intValue();
        }
        if (value instanceof java.math.BigInteger number && number.bitLength() < 32) {
            return number.intValue();
        }
        return value;
    }

    /** The overrides stored in {@code json}, leniently: whatever this build can't read is dropped. */
    public static Map<String, RuleSetting> read(QualityRuleRegistry registry, JsonNode json) {
        Map<String, RuleSetting> settings = new TreeMap<>();
        JsonNode rules = json == null ? null : json.path("rules");
        if (rules == null || !rules.isObject()) {
            return settings;
        }
        rules.fields().forEachRemaining(field -> registry.find(field.getKey()).ifPresent(rule -> {
            JsonNode node = field.getValue();
            QualitySeverity severity = QualitySeverity.parse(node.path("severity").asText(null));
            Map<String, Object> params = new LinkedHashMap<>();
            node.path("params").fields().forEachRemaining(param -> {
                JsonNode value = param.getValue();
                if (value.isBoolean()) {
                    params.put(param.getKey(), value.booleanValue());
                } else if (value.canConvertToInt() && value.isIntegralNumber()) {
                    params.put(param.getKey(), value.intValue());
                }
            });
            settings.put(rule.code(), new RuleSetting(severity == null ? rule.defaultSeverity() : severity, params));
        }));
        return settings;
    }

    /**
     * The stored form of {@code config}: only the rules whose severity or a parameter differs from the default, and of
     * those only the differing parameters; {@code null} when every rule is at its default.
     */
    public static JsonNode write(EffectiveQualityConfig config) {
        ObjectNode rules = JsonNodeFactory.instance.objectNode();
        for (QualityRule rule : config.registry().all()) {
            RuleSetting setting = config.setting(rule.code());
            ObjectNode params = JsonNodeFactory.instance.objectNode();
            for (RuleParam param : rule.params()) {
                Object value = setting.params().get(param.name());
                if (!Objects.equals(value, param.defaultValue())) {
                    if (value instanceof Boolean flag) {
                        params.put(param.name(), flag);
                    } else {
                        params.put(param.name(), (Integer) value);
                    }
                }
            }
            if (setting.severity() == rule.defaultSeverity() && params.isEmpty()) {
                continue;
            }
            ObjectNode entry = rules.putObject(rule.code());
            entry.put("severity", setting.severity().name());
            if (!params.isEmpty()) {
                entry.set("params", params);
            }
        }
        if (rules.isEmpty()) {
            return null;
        }
        ObjectNode root = JsonNodeFactory.instance.objectNode();
        root.set("rules", rules);
        return root;
    }

    /** The codes whose configured severity or a parameter differs between {@code before} and {@code after}. */
    public static List<String> changedCodes(EffectiveQualityConfig before, EffectiveQualityConfig after) {
        List<String> changed = new ArrayList<>();
        for (QualityRule rule : after.registry().all()) {
            if (!Objects.equals(before.setting(rule.code()), after.setting(rule.code()))) {
                changed.add(rule.code());
            }
        }
        return changed;
    }
}
