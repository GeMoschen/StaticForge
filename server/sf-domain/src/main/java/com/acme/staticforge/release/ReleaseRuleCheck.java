package com.acme.staticforge.release;

import com.acme.staticforge.asset.Asset;
import com.acme.staticforge.asset.AssetVersion;
import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.rules.ContentRules;
import com.acme.staticforge.asset.rules.RuleContexts;
import com.acme.staticforge.asset.rules.RuleEngine;
import com.acme.staticforge.asset.rules.RuleFill;
import com.acme.staticforge.asset.rules.RuleOutcome;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.rules.RuleScope;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The rule gate of a release (M33.6, replacing M27's completeness gate): per asset and released language, the
 * {@code release} fills, then the {@code release} rules and built-ins of the version about to be released, validated
 * against the <em>current</em> definition — the same one a build validates it with. Rules read the released state
 * ({@link RuleContexts.ReleasedState}): property sets and referenced assets as released, or as this release releases
 * them. {@code error} blocks ({@code SF-DOM-0150}), {@code warning} blocks unless accepted ({@code SF-DOM-0156}),
 * {@code info} never blocks.
 *
 * <p>A release checks every item it opens, so the check runs through a {@link Checker} per call (M27.1.4): templates,
 * dataset schemas, global set schemas and the validator are resolved once per checker, and a template without rules
 * reads nothing per item.
 */
@Component
public class ReleaseRuleCheck {

    private static final Set<String> RULE_CODES = Set.of(RuleEngine.CODE_RULE, RuleEngine.CODE_EVAL);

    private final ContentRules contentRules;
    private final RuleContexts contexts;

    public ReleaseRuleCheck(ContentRules contentRules, RuleContexts contexts) {
        this.contentRules = contentRules;
        this.contexts = contexts;
    }

    /**
     * A checker for the items of one release call in {@code projectId}; use it within that call's transaction.
     *
     * @param releasing the versions the call releases, by asset uuid — they count as released for {@code ref} and
     *     {@code global:}
     */
    public Checker checker(long projectId, Map<UUID, AssetVersion> releasing) {
        return new Checker(projectId, releasing);
    }

    /** The findings of one released language, by level. */
    public record Findings(List<ContentIssue> errors, List<ContentIssue> warnings, List<ContentIssue> infos) {

        public static final Findings NONE = new Findings(List.of(), List.of(), List.of());

        public Findings {
            errors = List.copyOf(errors);
            warnings = List.copyOf(warnings);
            infos = List.copyOf(infos);
        }
    }

    /**
     * The check of one asset version: its findings per locale key and the {@code release} fills; {@code filled} is
     * the payload with the fills applied, {@code null} when no fill changed a value.
     */
    public record Result(Map<String, Findings> byKey, List<RuleFill> fills, JsonNode filled) {

        public static final Result NONE = new Result(Map.of(), List.of(), null);

        public Findings forKey(String key) {
            return byKey.getOrDefault(key, Findings.NONE);
        }
    }

    /** The rule gate for many items of one project, each shared read resolved once. Not thread-safe. */
    public final class Checker {

        private final ContentRules.Session session;
        private final RuleContexts.ReleasedState state;

        private Checker(long projectId, Map<UUID, AssetVersion> releasing) {
            this.session = contentRules.session(projectId);
            this.state = contexts.releasedState(projectId, releasing);
        }

        /**
         * Checks {@code version} of {@code asset} for the locale {@code keys} being released ({@code ""} for all).
         *
         * @param statuses the asset's release states by locale key, as they are before this release
         */
        public Result check(Asset asset, AssetVersion version, Collection<String> keys, Map<String, LocaleRelease> statuses) {
            JsonNode payload = version.getPayload();
            Optional<ContentDefinition> definition = session.definition(asset.getAssetType(), payload);
            if (definition.isEmpty()) {
                return Result.NONE;
            }
            Collection<String> locales = keys.contains(ReleaseLocales.ALL) ? null : keys;
            RuleOutcome outcome = session.evaluate(asset.getAssetType(), definition.get(), payload, RuleScope.RELEASE,
                    locales, state.of(asset, version, statuses));
            Map<String, Findings> byKey = new java.util.LinkedHashMap<>();
            for (String key : keys) {
                List<ContentIssue> errors = new ArrayList<>();
                List<ContentIssue> warnings = new ArrayList<>();
                List<ContentIssue> infos = new ArrayList<>();
                for (ContentIssue finding : outcome.findings()) {
                    if (finding.kind() != ContentIssue.Kind.COMPLETENESS || !concerns(finding, key)) {
                        continue;
                    }
                    if (finding.severity() == Severity.ERROR) {
                        errors.add(finding);
                    } else if (finding.severity() == Severity.WARNING) {
                        warnings.add(finding);
                    } else if (finding.severity() == Severity.INFO) {
                        infos.add(finding);
                    }
                }
                byKey.put(key, new Findings(errors, warnings, infos));
            }
            return new Result(byKey, outcome.fills(), outcome.fills().isEmpty() ? null : outcome.content());
        }
    }

    /**
     * Whether {@code finding} concerns the release of locale {@code key}. A rule's finding of another language
     * doesn't; built-in findings concern every language, as the M27 gate had it.
     */
    private static boolean concerns(ContentIssue finding, String key) {
        return ReleaseLocales.ALL.equals(key)
                || !RULE_CODES.contains(finding.code())
                || finding.locale() == null
                || finding.locale().equals(key);
    }
}
