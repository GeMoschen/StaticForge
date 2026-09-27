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
 * {@code SF-CHK-0109} "Link reaches only a redirect" (M30.2.1): a reference to a path that a redirect of this build is
 * served at ({@link SiteIndex#redirectSources()}, the emitted redirects of M30.5) — an old URL of a moved or renamed
 * page. The link works, but every visit costs a hop; it should point at the page's current URL. A link to a redirect
 * source is never {@code SF-CHK-0101}.
 */
@Component
public class RedirectedTargetRule implements SiteRule {

    public static final String CODE = "SF-CHK-0109";

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
        return "Link reaches only a redirect";
    }

    @Override
    public String description() {
        return "A link points to an old URL that this build only serves as a redirect (the page moved or was renamed). "
                + "It works, but every visit takes an extra hop. Link the page's current URL, e.g. with "
                + "$CMS_REF(page:…)$, which follows moves by itself.";
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (LinkScan.Link link : LinkScan.internalLinks(site)) {
            if (site.isRedirectSource(link.target()) && LinkScan.firstOf(seen, link)) {
                findings.add(context.finding(link.key(), link.ref().selector(),
                        "Link to " + LinkScan.written(link) + " reaches only a redirect: it is an old URL; link the "
                                + "page's current URL instead."));
            }
        }
        return findings;
    }
}
