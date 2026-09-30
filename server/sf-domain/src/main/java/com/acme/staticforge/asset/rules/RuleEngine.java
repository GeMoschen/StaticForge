package com.acme.staticforge.asset.rules;

import com.acme.staticforge.asset.content.ContentIssue;
import com.acme.staticforge.asset.content.ContentValidator;
import com.acme.staticforge.asset.content.LocalizationContext;
import com.acme.staticforge.asset.content.PageContentValidator;
import com.acme.staticforge.asset.content.SectionTemplateLookup;
import com.acme.staticforge.common.L10nValues;
import com.acme.staticforge.template.content.ContentDefinition;
import com.acme.staticforge.template.content.EditorDefinition;
import com.acme.staticforge.template.diagnostic.Severity;
import com.acme.staticforge.template.expression.CompiledExpression;
import com.acme.staticforge.template.expression.EvaluationBudget;
import com.acme.staticforge.template.expression.ExpressionError;
import com.acme.staticforge.template.expression.ExpressionHost;
import com.acme.staticforge.template.expression.ExpressionScope;
import com.acme.staticforge.template.expression.ExpressionValues;
import com.acme.staticforge.template.rules.BuiltinRule;
import com.acme.staticforge.template.rules.FillDefinition;
import com.acme.staticforge.template.rules.FillMode;
import com.acme.staticforge.template.rules.RuleDefinition;
import com.acme.staticforge.template.rules.RuleMessages;
import com.acme.staticforge.template.rules.RulePath;
import com.acme.staticforge.template.rules.RuleScope;
import com.acme.staticforge.template.rules.StateDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;

/**
 * The editor-rule engine (M33.3, epic decision 5): one pure evaluation for every scope. For a content value and its
 * (effective) definition it
 *
 * <ol>
 *   <li>applies the scope's <b>fills</b> in dependency order ({@code mode empty} only into empty fields), so everything
 *       after sees the filled values;</li>
 *   <li>evaluates <b>states</b> — {@code requiredWhen} (a {@code required} finding when the field is empty) and
 *       {@code readOnlyWhen} — into {@link FieldState}s;</li>
 *   <li>runs the <b>custom rules</b> of the scope, per language ({@code locales}) and per list row for {@code list[]}
 *       targets, with their {@code when} preconditions;</li>
 *   <li>adds the <b>built-in</b> checks of {@link ContentValidator} (structural ones in every scope, completeness ones in
 *       the scopes their editor's overrides give them).</li>
 * </ol>
 *
 * Editors hidden by {@code visibleWhen} are skipped, as the built-ins skip them. An expression that fails or exceeds a
 * limit is a {@code rule-eval} warning and the rule counts as passed. Free of Spring and repositories: the
 * {@link RuleContextProvider} is the only boundary, so generation can back it with its snapshot.
 */
public final class RuleEngine {

    /** At most this many {@code ref(...)} lookups per evaluation (epic decision 4). */
    public static final int MAX_REFS = 200;

    /** The finding code of a custom rule. */
    public static final String CODE_RULE = "rule";

    /** The finding code of a rule that couldn't be evaluated (an expression error or a limit). */
    public static final String CODE_EVAL = "rule-eval";

    /** The finding code of a change to a read-only field that a save ignored (M33.4). */
    public static final String CODE_READ_ONLY = "read-only";

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private final ContentValidator validator;
    private final PageContentValidator pageValidator;

    public RuleEngine(ContentValidator validator) {
        this.validator = validator;
        this.pageValidator = new PageContentValidator(validator);
    }

    /**
     * What to evaluate: the {@code scope}, the {@code locales} to run for ({@code null}: every declared language, or
     * the single one of a project without languages) and the {@code provider} of everything beyond the content.
     */
    public record Request(RuleScope scope, Collection<String> locales, RuleContextProvider provider) {

        public Request {
            provider = provider == null ? RuleContextProvider.NONE : provider;
        }

        public static Request of(RuleScope scope) {
            return new Request(scope, null, RuleContextProvider.NONE);
        }
    }

    /**
     * Evaluates one content value — a record, a property set, a section on its own — against {@code definition}.
     *
     * @param kind the definition's kind keyword ({@code record}, {@code global}, {@code section}, {@code page}): the
     *     name {@link RuleContextProvider#meta()} is read under
     * @param pathPrefix the prefix of every finding path ({@code ""} for none)
     */
    public RuleOutcome evaluate(
            ContentDefinition definition, JsonNode content, String kind, String pathPrefix, Request request) {
        return evaluate(definition, content, kind, pathPrefix, null, request);
    }

    /**
     * As {@link #evaluate(ContentDefinition, JsonNode, String, String, Request)}, with the section templates catalog
     * cards resolve through for the built-in checks ({@code null}: cards aren't looked into, as before).
     */
    public RuleOutcome evaluate(
            ContentDefinition definition,
            JsonNode content,
            String kind,
            String pathPrefix,
            SectionTemplateLookup sections,
            Request request) {
        Run run = new Run(request);
        ObjectNode working = content != null && content.isObject() ? ((ObjectNode) content).deepCopy() : JSON.objectNode();
        if (definition != null && (content == null || content.isNull() || content.isMissingNode() || content.isObject())) {
            run.content(definition, working, kind, pathPrefix, pathPrefix, Map.of());
        }
        JsonNode checked = content != null && !content.isObject() && !content.isNull() && !content.isMissingNode()
                ? content
                : working;
        run.builtins(validator.validate(definition, checked, sections, pathPrefix));
        return run.outcome(checked);
    }

    /**
     * Evaluates a page payload ({@code {content, bodies, …}}): the page template's rules on its content — with
     * {@code body.<name>} the sections of each body — and every body section's own section-template rules — with
     * {@code section.page} the page's content — then the built-ins of the page and its sections.
     */
    public RuleOutcome evaluatePage(
            ContentDefinition pageDefinition, JsonNode payload, SectionTemplateLookup sections, Request request) {
        Run run = new Run(request);
        ObjectNode working = payload != null && payload.isObject() ? ((ObjectNode) payload).deepCopy() : JSON.objectNode();
        if (pageDefinition != null) {
            ObjectNode content = objectField(working, "content");
            Map<String, Function<String, JsonNode>> pageRoots = new HashMap<>();
            pageRoots.put("body", locale -> run.bodies(working, sections, locale));
            run.content(pageDefinition, content, "page", "content", "", pageRoots);
            JsonNode bodies = working.get("bodies");
            if (bodies != null && bodies.isObject() && sections != null) {
                bodies.fieldNames().forEachRemaining(bodyName -> {
                    JsonNode body = bodies.get(bodyName);
                    if (!body.isArray()) {
                        return;
                    }
                    for (int i = 0; i < body.size(); i++) {
                        JsonNode instance = body.get(i);
                        if (!instance.isObject()) {
                            continue;
                        }
                        Optional<SectionTemplateLookup.SectionTemplate> template =
                                sections.find(instance.path("templateRef").asText(""));
                        if (template.isEmpty() || template.get().definition().rules().isEmpty()) {
                            continue;
                        }
                        int index = i;
                        String instancePath = "bodies." + bodyName + "[" + i + "]";
                        Map<String, Function<String, JsonNode>> sectionRoots = new HashMap<>();
                        sectionRoots.put("section", locale -> {
                            ObjectNode section = JSON.objectNode();
                            section.set("page", run.resolve(content, locale));
                            section.put("body", bodyName);
                            section.put("index", index);
                            section.put("template", template.get().uid());
                            return section;
                        });
                        run.content(template.get().definition(), objectField((ObjectNode) instance, "content"),
                                "section", instancePath + ".content", instancePath, sectionRoots);
                    }
                });
            }
        }
        run.builtins(pageDefinition == null ? List.of() : pageValidator.validatePage(pageDefinition, working, sections));
        return run.outcome(working);
    }

    private static ObjectNode objectField(ObjectNode parent, String name) {
        JsonNode node = parent.get(name);
        if (node instanceof ObjectNode object) {
            return object;
        }
        ObjectNode created = JSON.objectNode();
        if (node == null || node.isNull() || node.isMissingNode()) {
            parent.set(name, created);
            return created;
        }
        return created; // a malformed value: rules see nothing, the built-ins report its shape
    }

    // ------------------------------------------------------------------

    /** One evaluation: the request, its budget and everything it collects. */
    private final class Run {

        private final RuleScope scope;
        private final RuleContextProvider provider;
        private final LocalizationContext localization;
        private final String uiLanguage;
        private final List<String> locales;
        private final EvaluationBudget budget = EvaluationBudget.standard();
        private final List<ContentIssue> findings = new ArrayList<>();
        private final List<RuleFill> fills = new ArrayList<>();
        private final Map<String, FieldState> states = new LinkedHashMap<>();
        private final Set<UUID> refTargets = new LinkedHashSet<>();
        private int refs;

        Run(Request request) {
            this.scope = request.scope();
            this.provider = request.provider();
            this.localization = validator.localization();
            this.uiLanguage = validator.uiLanguage();
            if (!localization.localized()) {
                List<String> none = new ArrayList<>();
                none.add(null);
                this.locales = none;
            } else if (request.locales() == null) {
                this.locales = localization.declaredLocales();
            } else {
                this.locales = request.locales().stream().filter(localization::declares).toList();
            }
        }

        private String defaultLocale() {
            return localization.localized() ? localization.defaultLocale() : null;
        }

        JsonNode resolve(JsonNode raw, String locale) {
            if (raw == null) {
                return NullNode.getInstance();
            }
            return localization.localized() ? L10nValues.resolveDeep(raw, localization.chain(locale)) : raw;
        }

        /** {@code body} for page rules: each body's sections as {@code [{template, instanceId, content}]} in {@code locale}. */
        JsonNode bodies(ObjectNode payload, SectionTemplateLookup sections, String locale) {
            ObjectNode out = JSON.objectNode();
            JsonNode bodies = payload.get("bodies");
            if (bodies == null || !bodies.isObject()) {
                return out;
            }
            bodies.fieldNames().forEachRemaining(name -> {
                ArrayNode list = out.putArray(name);
                JsonNode body = bodies.get(name);
                if (!body.isArray()) {
                    return;
                }
                for (JsonNode instance : body) {
                    ObjectNode section = list.addObject();
                    String ref = instance.path("templateRef").asText("");
                    String uid = sections == null ? null
                            : sections.find(ref).map(SectionTemplateLookup.SectionTemplate::uid).orElse(null);
                    section.put("template", uid);
                    section.set("instanceId", instance.path("instanceId"));
                    section.set("content", resolve(instance.get("content"), locale));
                }
            });
            return out;
        }

        // --------------------------------------------------------------

        /** Fills, states and custom rules of one definition over one content object. */
        void content(
                ContentDefinition definition,
                ObjectNode root,
                String kind,
                String pathPrefix,
                String wholePath,
                Map<String, Function<String, JsonNode>> extraRoots) {
            var rules = definition.rules();
            if (rules.isEmpty()) {
                return;
            }
            Context ctx = new Context(definition, root, kind, pathPrefix, wholePath, extraRoots);
            for (FillDefinition fill : rules.fillsInOrder()) {
                if (fill.runsIn(scope)) {
                    applyFill(ctx, fill);
                }
            }
            for (StateDefinition state : rules.states()) {
                evaluateState(ctx, state);
            }
            for (RuleDefinition rule : rules.rules()) {
                if (rule.runsIn(scope)) {
                    evaluateRule(ctx, rule);
                }
            }
        }

        void builtins(List<ContentIssue> issues) {
            for (ContentIssue issue : issues) {
                if (issue.appliesIn(scope)) {
                    findings.add(issue);
                }
            }
        }

        RuleOutcome outcome(JsonNode content) {
            return new RuleOutcome(findings, fills, List.copyOf(states.values()), content, refTargets);
        }

        // --------------------------------------------------------------

        private void applyFill(Context ctx, FillDefinition fill) {
            if (!ctx.visible(fill.target())) {
                return;
            }
            for (Instance instance : ctx.instances(fill.target())) {
                if (instance.holder() == null) {
                    continue; // a fill writes a field, not a whole row
                }
                boolean localizable = ctx.localizable(instance.editor());
                List<String> targets = localizable ? locales : singleLocale();
                for (String locale : targets) {
                    JsonNode computed;
                    try {
                        computed = ExpressionValues.toJson(
                                fill.value().evaluate(ctx.scope(locale, instance), host(locale), budget));
                    } catch (ExpressionError e) {
                        findings.add(evalError("fill of '" + fill.target().text() + "'", ctx.path(instance), locale, e));
                        continue;
                    }
                    JsonNode stored = instance.holder().get(instance.field());
                    JsonNode current = localizable ? L10nValues.get(stored, locale) : stored;
                    if (fill.mode() == FillMode.EMPTY && !isEmpty(instance.editor(), current)) {
                        continue;
                    }
                    if (fill.mode() == FillMode.EMPTY && ExpressionValues.isNull(computed)) {
                        continue;
                    }
                    if (fill.mode() == FillMode.ALWAYS) {
                        state(ctx.path(instance), localizable ? locale : null, false, true, true);
                    }
                    if (current != null && ExpressionValues.equal(current, computed)) {
                        continue;
                    }
                    instance.holder().set(instance.field(), localizable
                            ? L10nValues.with(stored, locale, computed.isNull() ? null : computed)
                            : computed);
                    fills.add(new RuleFill(ctx.path(instance), localizable ? locale : null, computed, fill.mode()));
                    ctx.invalidate();
                }
            }
        }

        private void evaluateState(Context ctx, StateDefinition state) {
            if (!ctx.visible(state.target())) {
                return;
            }
            for (Instance instance : ctx.instances(state.target())) {
                boolean localizable = ctx.localizable(instance.editor());
                String defaultLocale = defaultLocale();
                boolean required = false;
                if (state.requiredWhen() != null) {
                    try {
                        required = state.requiredWhen().test(
                                ctx.scope(defaultLocale, instance), host(defaultLocale), budget);
                    } catch (ExpressionError e) {
                        findings.add(evalError("requiredWhen of '" + state.target().text() + "'", ctx.path(instance), null, e));
                    }
                }
                for (String locale : localizable ? locales : singleLocale()) {
                    boolean readOnly = false;
                    if (state.readOnlyWhen() != null) {
                        try {
                            readOnly = state.readOnlyWhen().test(ctx.scope(locale, instance), host(locale), budget);
                        } catch (ExpressionError e) {
                            findings.add(evalError("readOnlyWhen of '" + state.target().text() + "'", ctx.path(instance), locale, e));
                        }
                    }
                    boolean requiredHere = required && (!localizable || locale == null || locale.equals(defaultLocale));
                    state(ctx.path(instance), localizable ? locale : null, requiredHere, readOnly);
                }
                if (required && instance.editor() != null && !instance.editor().required()) {
                    requiredFinding(ctx, state, instance, localizable);
                }
            }
        }

        /** A {@code required} finding from a {@code requiredWhen} that holds on an empty field. */
        private void requiredFinding(Context ctx, StateDefinition state, Instance instance, boolean localizable) {
            EditorDefinition editor = instance.editor();
            BuiltinRule builtin = editor.builtinRule("required");
            Set<RuleScope> scopes = state.scopes() != null
                    ? state.scopes()
                    : builtin.scopes() != null ? builtin.scopes() : ContentIssue.DEFAULT_SCOPES;
            if (!scopes.contains(scope)) {
                return;
            }
            JsonNode stored = instance.raw();
            String defaultLocale = defaultLocale();
            JsonNode value = localizable ? L10nValues.get(stored, defaultLocale) : stored;
            if (!isEmpty(editor, value)) {
                return;
            }
            Severity severity = state.level() != null
                    ? Severity.of(state.level())
                    : builtin.level() != null ? Severity.of(builtin.level()) : Severity.ERROR;
            RuleMessages messages = !state.messages().isEmpty() ? state.messages() : builtin.messages();
            String message = messages.isEmpty()
                    ? "Required editor '" + editor.name() + "' is empty" + (localizable ? " in the default language." : ".")
                    : RuleMessages.fill(messages.resolve(uiLanguage), placeholders(instance, value, localizable ? defaultLocale : null));
            String path = ctx.path(instance) + (localizable ? ".values." + defaultLocale : "");
            findings.add(new ContentIssue(path, "required", severity, message, ContentIssue.Kind.COMPLETENESS, "required",
                    scopes, messages.byLanguage(), localizable ? defaultLocale : null, builtin.onGeneration()));
        }

        private void evaluateRule(Context ctx, RuleDefinition rule) {
            if (!rule.target().isWhole() && !ctx.visible(rule.target())) {
                return;
            }
            boolean perLocale = ctx.localeDependent(rule);
            List<String> ruleLocales = perLocale ? locales : singleLocale();
            for (Instance instance : ctx.instances(rule.target())) {
                for (String locale : ruleLocales) {
                    if (perLocale && !rule.locales().includes(locale, defaultLocale())) {
                        continue;
                    }
                    ExpressionScope expressionScope = ctx.scope(locale, instance);
                    try {
                        if (rule.when() != null && !rule.when().test(expressionScope, host(locale), budget)) {
                            continue;
                        }
                        if (rule.assertion().test(expressionScope, host(locale), budget)) {
                            continue;
                        }
                    } catch (ExpressionError e) {
                        findings.add(evalError("rule '" + rule.name() + "'", ctx.path(instance), perLocale ? locale : null, e));
                        continue;
                    }
                    JsonNode value = ctx.resolved(instance.raw(), locale);
                    String message = RuleMessages.fill(rule.messages().resolve(uiLanguage),
                            placeholders(instance, value, perLocale ? locale : null));
                    findings.add(new ContentIssue(ctx.path(instance), CODE_RULE, Severity.of(rule.level()), message,
                            ContentIssue.Kind.COMPLETENESS, rule.name(), rule.scopes(), rule.messages().byLanguage(),
                            perLocale ? locale : null, rule.onGeneration()));
                }
            }
        }

        private ContentIssue evalError(String what, String path, String locale, ExpressionError e) {
            String name = what.startsWith("rule '") ? what.substring(6, what.length() - 1) : what;
            return new ContentIssue(path, CODE_EVAL, Severity.WARNING,
                    "The " + what + " could not be evaluated and counts as passed: " + e.getMessage(),
                    ContentIssue.Kind.COMPLETENESS, name, Set.of(scope), Map.of(), locale, null);
        }

        private Map<String, String> placeholders(Instance instance, JsonNode value, String locale) {
            Map<String, String> values = new HashMap<>();
            values.put("value", ExpressionValues.text(value));
            values.put("length", String.valueOf(length(value)));
            EditorDefinition editor = instance.editor();
            if (editor != null) {
                if (editor.min() != null) {
                    values.put("min", String.valueOf(editor.min()));
                }
                Integer max = editor.max() != null ? editor.max()
                        : editor.maxLength() != null ? editor.maxLength() : editor.maxChars();
                if (max != null) {
                    values.put("max", String.valueOf(max));
                }
            }
            if (instance.index() >= 0) {
                values.put("index", String.valueOf(instance.index() + 1));
            }
            if (locale != null) {
                values.put("locale", locale);
            }
            return values;
        }

        private void state(String path, String locale, boolean required, boolean readOnly) {
            state(path, locale, required, readOnly, false);
        }

        private void state(String path, String locale, boolean required, boolean readOnly, boolean computed) {
            String key = path + "|" + locale;
            FieldState existing = states.get(key);
            if (existing != null) {
                required |= existing.required();
                readOnly |= existing.readOnly();
                computed |= existing.computed();
            }
            states.put(key, new FieldState(path, locale, required, readOnly, computed));
        }

        private List<String> singleLocaleCache;

        /** The one run of a rule that doesn't depend on the language: the default language (or none). */
        private List<String> singleLocale() {
            if (singleLocaleCache == null) {
                List<String> one = new ArrayList<>();
                one.add(defaultLocale());
                singleLocaleCache = one;
            }
            return singleLocaleCache;
        }

        private ExpressionHost host(String locale) {
            return new ExpressionHost() {
                @Override
                public Clock clock() {
                    return provider.clock();
                }

                @Override
                public JsonNode ref(JsonNode value) {
                    if (++refs > MAX_REFS) {
                        throw new ExpressionError("More than " + MAX_REFS + " ref() lookups in one evaluation");
                    }
                    JsonNode uuid = value.path("uuid");
                    if (uuid.isTextual()) {
                        try {
                            refTargets.add(UUID.fromString(uuid.asText()));
                        } catch (IllegalArgumentException e) {
                            // not a reference value: nothing to record
                        }
                    }
                    JsonNode resolved = provider.ref(value, locale);
                    return resolved == null ? NullNode.getInstance() : resolved;
                }
            };
        }

        // --------------------------------------------------------------

        /** One definition's content in one evaluation: resolution caches, visibility and target instances. */
        private final class Context {

            private final ContentDefinition definition;
            private final ObjectNode root;
            private final String kind;
            private final String pathPrefix;
            private final String wholePath;
            private final Map<String, Function<String, JsonNode>> extraRoots;
            private final Map<String, JsonNode> resolvedByLocale = new HashMap<>();
            private JsonNode visibilityScope;

            Context(
                    ContentDefinition definition,
                    ObjectNode root,
                    String kind,
                    String pathPrefix,
                    String wholePath,
                    Map<String, Function<String, JsonNode>> extraRoots) {
                this.definition = definition;
                this.root = root;
                this.kind = kind;
                this.pathPrefix = pathPrefix;
                this.wholePath = wholePath;
                this.extraRoots = extraRoots;
            }

            void invalidate() {
                resolvedByLocale.clear();
                visibilityScope = null;
            }

            JsonNode resolved(JsonNode raw, String locale) {
                return resolve(raw, locale);
            }

            private JsonNode resolvedRoot(String locale) {
                return resolvedByLocale.computeIfAbsent(String.valueOf(locale), k -> resolve(root, locale));
            }

            String path(Instance instance) {
                if (instance.path() == null) {
                    return wholePath;
                }
                return pathPrefix.isEmpty() ? instance.path() : pathPrefix + "." + instance.path();
            }

            boolean localizable(EditorDefinition editor) {
                return editor != null && editor.localizable() && localization.localized();
            }

            ExpressionScope scope(String locale, Instance instance) {
                JsonNode content = resolvedRoot(locale);
                Map<String, JsonNode> roots = new HashMap<>();
                roots.put("value", instance.path() == null ? content : resolve(instance.raw(), locale));
                roots.put("item", instance.item() == null ? NullNode.getInstance() : resolve(instance.item(), locale));
                roots.put("parent", instance.parent() == null ? NullNode.getInstance() : resolve(instance.parent(), locale));
                roots.put("index", instance.index() < 0 ? NullNode.getInstance() : IntNode.valueOf(instance.index()));
                roots.put("locale", locale == null ? NullNode.getInstance() : TextNode.valueOf(locale));
                String defaultLocale = defaultLocale();
                roots.put("defaultLocale", defaultLocale == null ? NullNode.getInstance() : TextNode.valueOf(defaultLocale));
                JsonNode meta = provider.meta();
                if (meta != null) {
                    roots.put(kind, meta);
                }
                JsonNode release = provider.release(locale);
                roots.put("release", release == null ? NullNode.getInstance() : release);
                extraRoots.forEach((name, supplier) -> roots.put(name, supplier.apply(locale)));
                ExpressionScope base = new ExpressionScope() {
                    @Override
                    public JsonNode root(String name) {
                        return content.get(name);
                    }

                    @Override
                    public JsonNode global(String setUid) {
                        return provider.global(setUid, locale);
                    }
                };
                return base.with(roots);
            }

            /**
             * Whether a rule has to run per language: it reads a language-dependent editor or value, the language, the
             * release state, a body or section, a property set or a referenced asset. Otherwise it runs once.
             */
            boolean localeDependent(RuleDefinition rule) {
                if (!localization.localized()) {
                    return false;
                }
                if (!rule.locales().all()) {
                    return true;
                }
                for (CompiledExpression expression : new CompiledExpression[] {rule.assertion(), rule.when()}) {
                    if (expression == null) {
                        continue;
                    }
                    if (expression.functions().contains("ref")) {
                        return true;
                    }
                    for (String identifier : expression.identifiers()) {
                        String root = identifier.contains(".") ? identifier.substring(0, identifier.indexOf('.')) : identifier;
                        if (identifier.startsWith("global:") || Set.of("locale", "release", "body", "section").contains(root)) {
                            return true;
                        }
                        if (Set.of("value", "item", "parent").contains(root)) {
                            if (targetLocalizable(rule.target())) {
                                return true;
                            }
                            continue;
                        }
                        EditorDefinition editor = find(definition.editors(), root);
                        if (editor != null && subtreeLocalizable(editor)) {
                            return true;
                        }
                    }
                }
                return false;
            }

            private boolean targetLocalizable(RulePath target) {
                if (target.isWhole()) {
                    return definition.editors().stream().anyMatch(RuleEngine::subtreeLocalizable);
                }
                List<EditorDefinition> scope = definition.editors();
                for (RulePath.Segment segment : target.segments()) {
                    EditorDefinition editor = find(scope, segment.name());
                    if (editor == null) {
                        return false;
                    }
                    if (subtreeLocalizable(editor)) {
                        return true;
                    }
                    scope = editor.items();
                }
                return false;
            }

            /** Whether every editor on the way to {@code target} is visible (groups included), like the built-ins. */
            boolean visible(RulePath target) {
                if (target.isWhole()) {
                    return true;
                }
                if (visibilityScope == null) {
                    visibilityScope = localization.localized()
                            ? L10nValues.resolveDeep(root, List.of(localization.defaultLocale()))
                            : root;
                }
                List<EditorDefinition> scope = definition.editors();
                for (RulePath.Segment segment : target.segments()) {
                    List<EditorDefinition> chain = chain(scope, segment.name());
                    if (chain.isEmpty()) {
                        return false;
                    }
                    for (EditorDefinition editor : chain) {
                        if (!visible(editor)) {
                            return false;
                        }
                    }
                    scope = chain.get(chain.size() - 1).items();
                }
                return true;
            }

            private boolean visible(EditorDefinition editor) {
                String expression = editor.visibleWhen();
                if (expression == null || expression.isBlank()) {
                    return true;
                }
                try {
                    return validator.evaluator().evaluate(expression, visibilityScope);
                } catch (IllegalArgumentException e) {
                    return true;
                }
            }

            List<Instance> instances(RulePath target) {
                List<Instance> out = new ArrayList<>();
                if (target.isWhole()) {
                    out.add(new Instance(null, null, null, root, null, null, -1, null));
                    return out;
                }
                walk(definition.editors(), target.segments(), 0, root, "", null, null, -1, out);
                return out;
            }

            private void walk(
                    List<EditorDefinition> namespace,
                    List<RulePath.Segment> segments,
                    int i,
                    ObjectNode container,
                    String pathSoFar,
                    JsonNode item,
                    JsonNode parent,
                    int index,
                    List<Instance> out) {
                RulePath.Segment segment = segments.get(i);
                EditorDefinition editor = find(namespace, segment.name());
                if (editor == null) {
                    return;
                }
                boolean last = i == segments.size() - 1;
                String path = pathSoFar.isEmpty() ? segment.name() : pathSoFar + "." + segment.name();
                JsonNode value = container.get(segment.name());
                if (segment.rows()) {
                    if (value == null || !value.isArray()) {
                        return;
                    }
                    for (int j = 0; j < value.size(); j++) {
                        JsonNode row = value.get(j);
                        String rowPath = path + "[" + j + "]";
                        if (last) {
                            out.add(new Instance(rowPath, null, null, row, row, item, j, editor));
                        } else if (row instanceof ObjectNode rowObject) {
                            walk(editor.items(), segments, i + 1, rowObject, rowPath, row, item, j, out);
                        }
                    }
                    return;
                }
                if (last) {
                    out.add(new Instance(path, container, segment.name(), value, item, parent, index, editor));
                } else if (editor.isGroup()) {
                    // Groups are transparent: their members live in the same object.
                    walk(editor.items(), segments, i + 1, container, pathSoFar, item, parent, index, out);
                }
            }
        }
    }

    /**
     * One place a target resolves to: its content {@code path} relative to the definition ({@code null} for the whole
     * definition), the object {@code holder} and {@code field} it is stored under ({@code null} for a row), its raw
     * value, the enclosing row {@code item}, the row enclosing that ({@code parent}), the row {@code index} and the
     * editor.
     */
    private record Instance(
            String path,
            ObjectNode holder,
            String field,
            JsonNode raw,
            JsonNode item,
            JsonNode parent,
            int index,
            EditorDefinition editor) {}

    // ------------------------------------------------------------------

    private static boolean isEmpty(EditorDefinition editor, JsonNode value) {
        return editor != null ? ContentValidator.isEmptyValue(editor.type(), value) : ExpressionValues.isEmpty(value);
    }

    private static int length(JsonNode value) {
        if (ExpressionValues.isNull(value)) {
            return 0;
        }
        if (value.isArray()) {
            return value.size();
        }
        String text = ExpressionValues.text(value);
        return text.codePointCount(0, text.length());
    }

    /** An editor by name in a namespace; groups are transparent, a list's items are not. */
    static EditorDefinition find(List<EditorDefinition> namespace, String name) {
        List<EditorDefinition> chain = chain(namespace, name);
        return chain.isEmpty() ? null : chain.get(chain.size() - 1);
    }

    /** The groups leading to editor {@code name} in a namespace, then the editor; empty when there is none. */
    static List<EditorDefinition> chain(List<EditorDefinition> namespace, String name) {
        for (EditorDefinition editor : namespace) {
            if (editor.name().equals(name)) {
                return List.of(editor);
            }
            if (editor.isGroup()) {
                List<EditorDefinition> inner = chain(editor.items(), name);
                if (!inner.isEmpty()) {
                    List<EditorDefinition> out = new ArrayList<>();
                    out.add(editor);
                    out.addAll(inner);
                    return out;
                }
            }
        }
        return List.of();
    }

    static boolean subtreeLocalizable(EditorDefinition editor) {
        if (editor.localizable()) {
            return true;
        }
        for (EditorDefinition item : editor.items()) {
            if (subtreeLocalizable(item)) {
                return true;
            }
        }
        return false;
    }
}
