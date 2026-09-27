package com.acme.staticforge.generate.quality.rules.seo;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import com.acme.staticforge.generate.target.BuildManifest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * A text that several pages share — the title ({@code SF-CHK-0205}) or the meta description ({@code SF-CHK-0206}),
 * M30.2.2. Outputs are compared within one channel and one language only: the German and the English page, or the HTML
 * page and its AMP twin, may say the same. Every member of a duplicate group gets a finding naming the others (at most
 * {@link SeoText#MAX_NAMED}). Pages that ask search engines not to index them ({@code nav.noIndex}) are left out:
 * nobody compares them in a result list. Missing or empty texts are the business of their own rules.
 */
abstract class DuplicateTextRule implements SiteRule {

    /** What makes two outputs comparable: same channel, same language, same text. */
    private record Group(String channel, String locale, String text) {}

    private final String subject;

    /** @param subject what is compared, capitalized, for messages ("Title") */
    DuplicateTextRule(String subject) {
        this.subject = subject;
    }

    /** The text the output's facts state; {@code null} when it has none. */
    abstract String text(HtmlFacts facts);

    @Override
    public QualityCategory category() {
        return QualityCategory.SEO;
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        // Sorted by path within each group: stable messages and finding order.
        Map<Group, TreeMap<String, IndexedOutput>> groups = new HashMap<>();
        site.facts().forEach((path, facts) -> {
            IndexedOutput output = site.output(path).orElse(null);
            if (output == null || output.kind() != BuildManifest.Kind.PAGE || context.environment().noIndex(output.key())) {
                return;
            }
            String text = SeoText.normalize(text(facts));
            if (SeoText.blank(text)) {
                return;
            }
            groups.computeIfAbsent(new Group(output.key().channel(), output.key().locale(), text), k -> new TreeMap<>())
                    .put(path, output);
        });

        List<Finding> findings = new ArrayList<>();
        groups.entrySet().stream()
                .filter(group -> group.getValue().size() > 1)
                .sorted(Comparator.comparing(group -> group.getValue().firstKey()))
                .forEach(group -> {
                    TreeMap<String, IndexedOutput> members = group.getValue();
                    for (IndexedOutput member : members.values()) {
                        List<String> others = members.keySet().stream()
                                .filter(path -> !path.equals(member.path()))
                                .toList();
                        findings.add(context.finding(member.key(), null, subject + " \"" + group.getKey().text()
                                + "\" is also used by " + SeoText.names(others) + "."));
                    }
                });
        return findings;
    }
}
