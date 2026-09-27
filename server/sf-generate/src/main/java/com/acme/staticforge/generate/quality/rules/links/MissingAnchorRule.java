package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.HtmlFacts;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import com.acme.staticforge.generate.target.BuildManifest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0107} "Missing anchor" (M30.2.1): a link's {@code #fragment} names no element {@code id} and no
 * {@code <a name>} of the target page — the page itself for {@code #section}, the linked page for
 * {@code other.html#section}.
 *
 * <p>Not reported: a bare {@code #} and {@code #top} (the top of the document, HTML's own fragment), text fragments
 * ({@code #:~:text=…}), fragments on media (a PDF's {@code #page=2} is the viewer's business), targets that aren't
 * checked HTML (another channel, a carried output without facts), targets whose ids were too many to record, and
 * missing targets ({@code SF-CHK-0101}).
 */
@Component
public class MissingAnchorRule implements SiteRule {

    public static final String CODE = "SF-CHK-0107";

    /** Starts a text fragment directive ({@code #section:~:text=word}), which isn't an element id. */
    private static final String TEXT_DIRECTIVE = ":~:";

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
        return "Missing anchor";
    }

    @Override
    public String description() {
        return "A link's #fragment names no element id (or <a name>) on the target page, so the browser opens the page "
                + "at the top instead of the section. Fix the fragment, or give the target element that id. A bare "
                + "# and #top are fine; fragments on media files are not checked.";
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (LinkScan.Link link : LinkScan.internalLinks(site)) {
            String fragment = anchor(link.ref().fragment());
            if (fragment == null) {
                continue;
            }
            IndexedOutput target = site.output(link.target()).orElse(null);
            HtmlFacts facts = site.factsOf(link.target()).orElse(null);
            if (target == null || target.kind() != BuildManifest.Kind.PAGE || facts == null || facts.hasTarget(fragment)
                    || facts.idsTruncated() || !seen.add(link.key().path() + '\u0000' + link.ref().selector() + '\u0000'
                            + link.target() + '#' + fragment)) {
                continue;
            }
            String where = link.target().equals(link.key().path())
                    ? "this page"
                    : LinkScan.output(context.environment(), target);
            findings.add(context.finding(link.key(), link.ref().selector(),
                    "Missing anchor: " + LinkScan.quote(link.ref().raw().strip()) + " — " + where
                            + " has no element with id or name '" + fragment + "'."));
        }
        return findings;
    }

    /** The element id a fragment names; {@code null} for none, a bare {@code #}, {@code #top} or a text directive. */
    static String anchor(String fragment) {
        if (fragment == null) {
            return null;
        }
        int directive = fragment.indexOf(TEXT_DIRECTIVE);
        String id = directive < 0 ? fragment : fragment.substring(0, directive);
        if (id.isEmpty() || id.toLowerCase(Locale.ROOT).equals("top")) {
            return null;
        }
        return id;
    }
}
