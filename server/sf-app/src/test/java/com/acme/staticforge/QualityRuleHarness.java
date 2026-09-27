package com.acme.staticforge;

import com.acme.staticforge.channel.ChannelOutputSettings;
import com.acme.staticforge.generate.quality.AssetLabel;
import com.acme.staticforge.generate.quality.CheckEnvironment;
import com.acme.staticforge.generate.quality.EffectiveQualityConfig;
import com.acme.staticforge.generate.quality.EffectiveQualityConfig.RuleSetting;
import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.PageRuleRunner;
import com.acme.staticforge.generate.quality.QualityRule;
import com.acme.staticforge.generate.quality.QualityRuleRegistry;
import com.acme.staticforge.generate.quality.QualitySeverity;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRuleRunner;
import com.acme.staticforge.generate.quality.rules.OutputNotCheckedRule;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.LocaleConfig;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * Runs quality rules over fixture HTML without a build (M30.1.1) — the rule tests' workhorse. Declare the site (HTML
 * page outputs with their text or a fixture file under {@code src/test/resources/quality/}, media and site files,
 * held-back paths, the renderer's reference events, redirect sources), configure severities and parameters, and
 * {@link #run()}: every page rule runs on every page output, then the site rules in the build's two phases — exactly
 * the order and the hold-back of a build (epic decision 6), without rendering anything.
 *
 * <pre>{@code
 * List<Finding> findings = QualityRuleHarness.of(new MissingAltRule())
 *         .page("index.html", "<img src=\"a.png\">")
 *         .run()
 *         .findings();
 * }</pre>
 *
 * Page outputs are in channel {@code html} by default; {@link #page(OutputKey, String)} sets another key (a locale, a
 * page number, a channel). Asset uuids are derived from the path unless given, so one page's outputs share an asset
 * only when the key says so.
 */
public final class QualityRuleHarness {

    private final QualityRuleRegistry registry;
    private final Map<String, RuleSetting> settings = new HashMap<>();
    private final Map<String, IndexedOutput> outputs = new LinkedHashMap<>();
    private final Map<String, String> html = new LinkedHashMap<>();
    private final Set<String> heldBack = new LinkedHashSet<>();
    private final Map<String, List<ReferenceEvent>> events = new LinkedHashMap<>();
    private final Set<String> redirectSources = new LinkedHashSet<>();
    private final Set<String> noIndex = new LinkedHashSet<>();
    private final Map<String, ChannelOutputSettings> channels = new HashMap<>();
    private final Map<UUID, AssetLabel> assets = new HashMap<>();
    private String baseUrl = "https://example.com";
    private LocaleConfig locales = LocaleConfig.EMPTY;

    private QualityRuleHarness(List<QualityRule> rules) {
        List<QualityRule> all = new ArrayList<>(rules);
        if (rules.stream().noneMatch(rule -> rule instanceof OutputNotCheckedRule)) {
            all.add(new OutputNotCheckedRule());
        }
        this.registry = new QualityRuleRegistry(all);
    }

    /** A harness running {@code rules} (plus {@code SF-CHK-0001}, the framework's own), each at its default. */
    public static QualityRuleHarness of(QualityRule... rules) {
        return new QualityRuleHarness(List.of(rules));
    }

    /** The text of fixture {@code quality/<name>} from the test classpath. */
    public static String fixture(String name) {
        String resource = "quality/" + name;
        try (InputStream in = QualityRuleHarness.class.getClassLoader().getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalArgumentException("No fixture " + resource + " on the test classpath.");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** The asset uuid the harness gives the output at {@code path} when none is set. */
    public static UUID assetOf(String path) {
        return UUID.nameUUIDFromBytes(path.getBytes(StandardCharsets.UTF_8));
    }

    // ------------------------------------------------------------------
    // The site
    // ------------------------------------------------------------------

    /** The target's {@code baseUrl} ({@code https://example.com} by default; {@code ""} for none). */
    public QualityRuleHarness baseUrl(String value) {
        this.baseUrl = value;
        return this;
    }

    /** The project's locales. */
    public QualityRuleHarness locales(LocaleConfig value) {
        this.locales = value;
        return this;
    }

    /** Output settings of {@code channel} (defaults: {@code html}, {@code index.html}). */
    public QualityRuleHarness channel(String channel, ChannelOutputSettings value) {
        channels.put(channel, value);
        return this;
    }

    /** How messages name asset {@code uuid}. */
    public QualityRuleHarness asset(AssetLabel label) {
        assets.put(label.uuid(), label);
        return this;
    }

    /** An HTML page output at {@code path} in channel {@code html}, rendered by this build. */
    public QualityRuleHarness page(String path, String text) {
        return page(new OutputKey(path, assetOf(path), "html", null, null), text);
    }

    /** An HTML page output with an explicit key, rendered by this build. */
    public QualityRuleHarness page(OutputKey key, String text) {
        outputs.put(key.path(), new IndexedOutput(key, BuildManifest.Kind.PAGE, false));
        html.put(key.path(), text);
        return this;
    }

    /** An HTML page output at {@code path} whose text is fixture {@code quality/<name>}. */
    public QualityRuleHarness pageFromFixture(String path, String name) {
        return page(path, fixture(name));
    }

    /** A page output that is not checked (a non-HTML channel, or a carried output without facts). */
    public QualityRuleHarness unchecked(OutputKey key) {
        outputs.put(key.path(), new IndexedOutput(key, BuildManifest.Kind.PAGE, false));
        return this;
    }

    /** A media output at {@code path}; its asset uuid is {@link #assetOf(String)}. */
    public QualityRuleHarness media(String path) {
        outputs.put(path, new IndexedOutput(
                new OutputKey(path, assetOf(path), null, null, null), BuildManifest.Kind.MEDIA, false));
        return this;
    }

    /** A site file ({@code sitemap.xml}, {@code search-index.json}) at {@code path}. */
    public QualityRuleHarness siteFile(String path) {
        outputs.put(path, new IndexedOutput(new OutputKey(path, null, null, null, null), BuildManifest.Kind.SITE, false));
        return this;
    }

    /** A page output the build planned but held back before the checks (e.g. {@code SF-GEN-0120}). */
    public QualityRuleHarness heldBack(String path) {
        heldBack.add(path);
        return this;
    }

    /** A reference the renderer could not resolve while rendering the output at {@code path}. */
    public QualityRuleHarness event(String path, ReferenceEvent event) {
        events.computeIfAbsent(path, key -> new ArrayList<>()).add(event);
        return this;
    }

    /** A path an emitted redirect of this build is served at. */
    public QualityRuleHarness redirectSource(String path) {
        redirectSources.add(path);
        return this;
    }

    /** Marks the page output at {@code path} as one of a page with {@code nav.noIndex} (M30.2.2). */
    public QualityRuleHarness noIndex(String path) {
        noIndex.add(path);
        return this;
    }

    // ------------------------------------------------------------------
    // Configuration
    // ------------------------------------------------------------------

    /** Configures rule {@code code} at {@code severity} with its default parameters. */
    public QualityRuleHarness configure(String code, QualitySeverity severity) {
        return configure(code, severity, Map.of());
    }

    /** Configures rule {@code code} at {@code severity} with {@code params} overriding its defaults. */
    public QualityRuleHarness configure(String code, QualitySeverity severity, Map<String, Object> params) {
        settings.put(code, new RuleSetting(severity, params));
        return this;
    }

    // ------------------------------------------------------------------
    // Running
    // ------------------------------------------------------------------

    /**
     * What a run found.
     *
     * @param findings every finding: page rules per output in declaration order, then the site rules of both phases
     * @param facts the extracted facts per checked output
     * @param heldBack the page outputs held back: the declared ones plus those with an {@code ERROR} finding
     */
    public record Result(List<Finding> findings, Map<String, HtmlFacts> facts, Set<String> heldBack) {

        /** The findings of rule {@code code}. */
        public List<Finding> of(String code) {
            return findings.stream().filter(finding -> finding.code().equals(code)).toList();
        }

        /** The findings on the output at {@code path}. */
        public List<Finding> on(String path) {
            return findings.stream().filter(finding -> finding.output().path().equals(path)).toList();
        }

        /** Every finding's code, in order. */
        public List<String> codes() {
            return findings.stream().map(Finding::code).toList();
        }
    }

    /** Runs the rules as a build would: page rules, site rules, hold-back, then the rules after the hold-back. */
    public Result run() {
        EffectiveQualityConfig config = EffectiveQualityConfig.of(registry, settings);
        CheckEnvironment environment = new CheckEnvironment(baseUrl, locales, outputs,
                channel -> channels.getOrDefault(channel, ChannelOutputSettings.defaults(channel)), assets::get, events,
                key -> noIndex.contains(key.path()));
        PageRuleRunner pages = new PageRuleRunner(registry);
        SiteRuleRunner sites = new SiteRuleRunner(registry);

        List<Finding> findings = new ArrayList<>();
        Map<String, HtmlFacts> facts = new LinkedHashMap<>();
        html.forEach((path, text) -> {
            IndexedOutput output = outputs.get(path);
            PageRuleRunner.PageCheck check = pages.check(
                    output.key(), text.getBytes(StandardCharsets.UTF_8), config, environment);
            if (check.facts() != null) {
                facts.put(path, check.facts());
            }
            findings.addAll(check.findings());
        });

        SiteIndex site = new SiteIndex(environment, facts, heldBack, events, redirectSources);
        findings.addAll(sites.run(site, config, false));

        // Like the build: an ERROR holds back every output of that page in that channel and language.
        Set<String> held = new LinkedHashSet<>(heldBack);
        findings.stream().filter(Finding::isError).map(Finding::output).forEach(errorOn -> outputs.values().stream()
                .filter(output -> output.kind() == BuildManifest.Kind.PAGE)
                .map(IndexedOutput::key)
                .filter(key -> Objects.equals(key.asset(), errorOn.asset())
                        && Objects.equals(key.channel(), errorOn.channel())
                        && Objects.equals(key.locale(), errorOn.locale()))
                .forEach(key -> held.add(key.path())));
        Map<String, IndexedOutput> published = new LinkedHashMap<>(outputs);
        published.keySet().removeAll(held);
        Map<String, HtmlFacts> publishedFacts = new LinkedHashMap<>(facts);
        publishedFacts.keySet().removeAll(held);
        CheckEnvironment afterHoldBack = new CheckEnvironment(baseUrl, locales, published,
                channel -> channels.getOrDefault(channel, ChannelOutputSettings.defaults(channel)), assets::get, events,
                key -> noIndex.contains(key.path()));
        findings.addAll(sites.run(
                new SiteIndex(afterHoldBack, publishedFacts, held, events, redirectSources), config, true));
        return new Result(List.copyOf(findings), Map.copyOf(facts), Set.copyOf(held));
    }

    /** Shorthand for {@code run().findings()}. */
    public List<Finding> findings() {
        return run().findings();
    }

    /** Every code {@code rules} define — handy for asserting a catalogue. */
    public static List<String> codes(QualityRule... rules) {
        return Stream.of(rules).map(QualityRule::code).toList();
    }
}
