package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import com.acme.staticforge.generate.target.BuildManifest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0106} "Link into another channel" (M30.2.1): an {@code a[href]} or {@code iframe[src]} of a page output
 * that goes to a page output of another channel — an HTML page linking the Markdown output of a page, usually a
 * hard-coded extension in a template or a {@code $CMS_REF} resolved for the wrong channel.
 */
@Component
public class OtherChannelTargetRule implements SiteRule {

    public static final String CODE = "SF-CHK-0106";

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
        return "Link into another channel";
    }

    @Override
    public String description() {
        return "A link on a page goes to a page output of another channel (an HTML page linking a page's Markdown "
                + "output). Readers land on a file meant for another use. Link the page in the same channel; switch the "
                + "rule off when the site offers other formats on purpose.";
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (LinkScan.Link link : LinkScan.internalLinks(site)) {
            if (link.media()) {
                continue;
            }
            IndexedOutput target = site.output(link.target()).orElse(null);
            String from = link.key().channel();
            if (target == null || target.kind() != BuildManifest.Kind.PAGE || from == null
                    || target.key().channel() == null || Objects.equals(from, target.key().channel())
                    || !LinkScan.firstOf(seen, link)) {
                continue;
            }
            findings.add(context.finding(link.key(), link.ref().selector(),
                    "Link to " + LinkScan.written(link) + " goes to " + LinkScan.output(context.environment(), target)
                            + " in channel '" + target.key().channel() + "', not '" + from + "'."));
        }
        return findings;
    }
}
