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
 * {@code SF-CHK-0102} "Link to missing media" (M30.2.1): an {@code img}, {@code source}, {@code video}, {@code audio},
 * {@code script} or {@code link} reference — {@code src}, every {@code srcset} candidate, {@code poster}, {@code href} —
 * that resolves to a path of the site which is no output of the build. The document's canonical link and its
 * {@code hreflang} alternates are the SEO rules' ({@code SF-CHK-0210}, {@code SF-CHK-0211}).
 */
@Component
public class MissingMediaRule implements SiteRule {

    public static final String CODE = "SF-CHK-0102";

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
        return "Link to missing media";
    }

    @Override
    public String description() {
        return "An image, video, audio, script or stylesheet reference (src, each srcset candidate, poster, link href) "
                + "points to a path of this site that the build doesn't publish, so the browser gets a 404. Usually a "
                + "hard-coded path in the template: reference the media asset with $CMS_REF(media:…)$ instead, or add "
                + "the missing file.";
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (LinkScan.Link link : LinkScan.internalLinks(site)) {
            if (link.media() && MissingLinkTargetRule.missing(site, link.target()) && LinkScan.firstOf(seen, link)) {
                findings.add(context.finding(link.key(), link.ref().selector(),
                        "Missing media " + LinkScan.written(link) + " (" + link.ref().element() + " "
                                + link.ref().attribute() + "): no file of this build is there."));
            }
        }
        return findings;
    }
}
