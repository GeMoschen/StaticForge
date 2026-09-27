package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.LinkRef;
import com.acme.staticforge.generate.quality.OutputKey;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import com.acme.staticforge.generate.target.BuildManifest;
import com.acme.staticforge.project.LocaleConfig;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0210} "{@code hreflang} alternates incomplete, not reciprocal or pointing nowhere" (M30.2.2), in a
 * localized project only. One page (asset and channel) is published in some languages — after M27's per-language
 * release and after this build's hold-back. Each of its outputs that declares {@code <link rel="alternate" hreflang>}:
 * <ul>
 *   <li>names every language the page is published in, its own included (a paginated page's later pages may point at
 *       page 1 of the other languages, as {@code CMS_LOCALES} hrefs do);</li>
 *   <li>points only at outputs of this build — not at a language the page is held back in or not released in — and
 *       only at this page's outputs, each under an {@code hreflang} that fits the output's language ({@code de} or
 *       {@code de-CH} for a {@code de-CH} output); {@code x-default} at any of the page's outputs;</li>
 *   <li>is answered: the output an alternate points at names this output's language back, with a link to this page.</li>
 * </ul>
 * An output without any alternates is fine, unless the project has more than one language and the page is published in
 * more than one of them. Alternates to another host aren't checked (epic decision 1), but still name their language.
 *
 * <p>Runs after the hold-back (it reports alternates to held-back outputs), so it is capped at {@code WARNING}.
 */
@Component
public class HreflangRule implements SiteRule {

    private static final String X_DEFAULT = "x-default";

    /** One page in one channel: the outputs that are each other's translations. */
    private record Page(UUID asset, String channel) {

        static Page of(OutputKey key) {
            return new Page(key.asset(), key.channel());
        }
    }

    @Override
    public String code() {
        return "SF-CHK-0210";
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public String name() {
        return "Language alternates incomplete or broken";
    }

    @Override
    public String description() {
        return "In a project with languages, a page's <link rel=\"alternate\" hreflang> links don't name every "
                + "language the page is published in, point at an output this build doesn't publish (held back, or "
                + "not released in that language), point at another page, or aren't answered by the page they point "
                + "at. Build them in the page template from CMS_LOCALES, skipping languages whose href is empty.";
    }

    @Override
    public boolean afterHoldBack() {
        return true;
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        if (!context.environment().localized()) {
            return List.of();
        }
        // The languages each page is published in, from every page output of the build.
        Map<Page, Set<String>> published = new HashMap<>();
        for (IndexedOutput output : site.outputs().values()) {
            OutputKey key = output.key();
            if (output.kind() == BuildManifest.Kind.PAGE && key.asset() != null && key.locale() != null) {
                published.computeIfAbsent(Page.of(key), k -> new TreeSet<>()).add(key.locale());
            }
        }
        int projectLocales = context.environment().locales().locales().size();

        List<Finding> findings = new ArrayList<>();
        for (Map.Entry<String, HtmlFacts> entry : new TreeMap<>(site.facts()).entrySet()) {
            IndexedOutput output = site.output(entry.getKey()).orElse(null);
            if (output == null || output.kind() != BuildManifest.Kind.PAGE || output.key().asset() == null
                    || output.key().locale() == null) {
                continue;
            }
            OutputKey self = output.key();
            Set<String> languages = published.getOrDefault(Page.of(self), Set.of(self.locale()));
            List<HtmlFacts.Alternate> alternates = entry.getValue().alternates();
            if (alternates.isEmpty()) {
                if (projectLocales > 1 && languages.size() > 1) {
                    findings.add(context.finding(self, null, "The page has no hreflang alternates, but is published "
                            + "in " + String.join(", ", languages) + "."));
                }
                continue;
            }
            Set<String> named = new LinkedHashSet<>();
            for (HtmlFacts.Alternate alternate : alternates) {
                String problem = check(site, context, self, languages, alternate, named);
                if (problem != null) {
                    findings.add(context.finding(self, alternate.link().selector(), problem));
                }
            }
            List<String> missing = languages.stream().filter(locale -> !named.contains(locale)).toList();
            if (!missing.isEmpty()) {
                findings.add(context.finding(self, null, "The hreflang alternates don't name "
                        + String.join(", ", missing) + ", in which the page is published."));
            }
        }
        return findings;
    }

    /**
     * What is wrong with one alternate of {@code self}; {@code null} when nothing is. Adds the language the alternate
     * names (its target's, else the project language its {@code hreflang} spells) to {@code named}.
     */
    private static String check(
            SiteIndex site,
            RuleContext context,
            OutputKey self,
            Set<String> languages,
            HtmlFacts.Alternate alternate,
            Set<String> named) {
        String hreflang = alternate.hreflang();
        LinkRef link = alternate.link();
        String label = "hreflang \"" + hreflang + "\"";
        boolean xDefault = X_DEFAULT.equalsIgnoreCase(hreflang);
        LocaleConfig locales = context.environment().locales();
        String spelled = xDefault ? null : locales.canonicalDeclared(hreflang);

        if (!link.internal()) {
            // Another host is not ours to check; its hreflang still names a language.
            if (spelled != null) {
                named.add(spelled);
                if (!languages.contains(spelled)) {
                    return label + " names " + spelled + ", in which the page is not published.";
                }
            }
            return link.raw() == null || link.raw().isBlank() ? label + " has an empty href." : null;
        }
        String path = link.resolvedPath();
        IndexedOutput target = site.output(path).orElse(null);
        if (target == null) {
            return label + " points at " + path + (site.isHeldBack(path)
                    ? ", which is held back in this build."
                    : ", which is not an output of this build.");
        }
        OutputKey to = target.key();
        if (target.kind() != BuildManifest.Kind.PAGE || !Objects.equals(to.asset(), self.asset())
                || !Objects.equals(to.channel(), self.channel())) {
            return label + " points at " + path + ", which is not an output of this page.";
        }
        if (xDefault) {
            return null;
        }
        named.add(to.locale());
        if (!fits(hreflang, to.locale())) {
            return label + " points at " + path + ", the page's " + to.locale() + " output.";
        }
        if (!to.locale().equals(self.locale()) && !answers(site, to, self)) {
            return label + " points at " + path + ", which doesn't name " + self.locale() + " back.";
        }
        return null;
    }

    /** Whether {@code hreflang} spells {@code locale}: its full tag or its language ({@code de} for {@code de-CH}). */
    private static boolean fits(String hreflang, String locale) {
        return hreflang.equalsIgnoreCase(locale) || hreflang.equalsIgnoreCase(LocaleConfig.language(locale));
    }

    /**
     * Whether the output {@code to} names {@code self}'s language back: one of its alternates points at an output of
     * the same page in {@code self}'s language. An output without facts (not checked) or without any alternates
     * isn't held against {@code self} — the latter is reported on that output itself.
     */
    private static boolean answers(SiteIndex site, OutputKey to, OutputKey self) {
        HtmlFacts facts = site.factsOf(to.path()).orElse(null);
        if (facts == null || facts.alternates().isEmpty()) {
            return true;
        }
        for (HtmlFacts.Alternate back : facts.alternates()) {
            if (!back.link().internal()) {
                continue;
            }
            IndexedOutput target = site.output(back.link().resolvedPath()).orElse(null);
            if (target != null && Objects.equals(target.key().asset(), self.asset())
                    && Objects.equals(target.key().channel(), self.channel())
                    && Objects.equals(target.key().locale(), self.locale())) {
                return true;
            }
        }
        return false;
    }
}
