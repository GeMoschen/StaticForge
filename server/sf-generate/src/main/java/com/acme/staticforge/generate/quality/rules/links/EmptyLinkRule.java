package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.PageRule;
import com.acme.staticforge.generate.quality.ParsedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.quality.RuleContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.jsoup.nodes.Element;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0108} "Empty or {@code #}-only link" (M30.2.1): an {@code a[href]} whose {@code href} is empty,
 * whitespace or a bare {@code #} — it reloads the page or jumps to its top instead of going anywhere.
 *
 * <p>Not reported:
 * <ul>
 *   <li>an element with {@code role="button"}: script-driven controls declare themselves that way (a real
 *       {@code <button>} is better, but that is an accessibility question, not a broken link);</li>
 *   <li>an empty {@code href} on an output whose renderer reported an unresolved page, media or folder reference: a
 *       reference to an unreleased, deleted or missing target renders {@code ""}, and {@code SF-CHK-0104},
 *       {@code SF-CHK-0105} or {@code SF-CHK-0101} already report it, naming the target — one broken link, one
 *       finding.</li>
 * </ul>
 */
@Component
public class EmptyLinkRule implements PageRule {

    public static final String CODE = "SF-CHK-0108";

    /** Reference kinds whose unresolved reference renders an empty URL (a missing section renders no markup). */
    private static final Set<String> URL_REFERENCES = Set.of("page", "media", "folder");

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.LINKS;
    }

    @Override
    public String name() {
        return "Empty or #-only link";
    }

    @Override
    public String description() {
        return "A link's href is empty, whitespace or just \"#\", so it reloads the page or jumps to the top. Give it a "
                + "real target, or use a <button> for an action. Elements with role=\"button\" are not reported, nor "
                + "empty links that come from a reference to an unreleased, deleted or missing asset (reported as "
                + "SF-CHK-0104, SF-CHK-0105 or SF-CHK-0101 with the target).";
    }

    @Override
    public List<Finding> check(ParsedOutput output, RuleContext context) {
        boolean unresolvedUrls = context.environment().referenceEvents(output.path()).stream()
                .map(ReferenceEvent::targetKind)
                .anyMatch(URL_REFERENCES::contains);
        List<Finding> findings = new ArrayList<>();
        for (Element link : output.document().select("a[href]")) {
            String href = link.attr("href").strip();
            if (!href.isEmpty() && !href.equals("#") || link.attr("role").strip().equalsIgnoreCase("button")) {
                continue;
            }
            if (href.isEmpty() && unresolvedUrls) {
                continue;
            }
            findings.add(context.finding(link, href.isEmpty()
                    ? "Empty link: the href is empty, so it only reloads the page."
                    : "Link with href=\"#\": it goes nowhere but to the top of the page."));
        }
        return findings;
    }
}
