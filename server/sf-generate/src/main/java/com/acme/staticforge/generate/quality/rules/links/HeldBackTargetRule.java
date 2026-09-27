package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0103} "Link to a page held back in this build" (M30.2.1, epic decision 6): a reference to a page output
 * the build planned but doesn't publish — held back for incomplete content ({@code SF-GEN-0120}), a render limit or a
 * quality {@code ERROR} ({@code SF-GEN-0125}). It runs after the hold-back and is capped at {@code WARNING}: holding one
 * page back never holds back the pages that link to it.
 */
@Component
public class HeldBackTargetRule implements SiteRule {

    public static final String CODE = "SF-CHK-0103";

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
        return "Link to a page held back in this build";
    }

    @Override
    public String description() {
        return "A link points to a page this build held back (incomplete content, or a quality check configured as "
                + "error), so the link is broken until that page is fixed and built again. Fix the held-back page. "
                + "Reported at most as a warning: a held-back page never holds back the pages that link to it.";
    }

    @Override
    public boolean afterHoldBack() {
        return true;
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (LinkScan.Link link : LinkScan.internalLinks(site)) {
            if (site.isHeldBack(link.target()) && LinkScan.firstOf(seen, link)) {
                findings.add(context.finding(link.key(), link.ref().selector(),
                        "Link to " + LinkScan.written(link) + ": the page is held back in this build."));
            }
        }
        return findings;
    }
}
