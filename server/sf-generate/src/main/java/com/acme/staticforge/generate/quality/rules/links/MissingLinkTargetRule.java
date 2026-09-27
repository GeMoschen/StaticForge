package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0101} "Link to a missing page or file" (M30.2.1, epic decisions 1 and 8): an {@code a[href]} or
 * {@code iframe[src]} that resolves to a path of the site which is no output of the build — no page (rendered or
 * carried), media file or site file — and a reference whose target isn't in the project at all (the renderer's
 * {@link ReferenceEvent.Kind#MISSING} events, which render {@code ""}).
 *
 * <p>Not reported here: a path held back in this build ({@code SF-CHK-0103}), a path served by a redirect
 * ({@code SF-CHK-0109}) and media references ({@code SF-CHK-0102}).
 */
@Component
public class MissingLinkTargetRule implements SiteRule {

    public static final String CODE = "SF-CHK-0101";

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
        return "Link to a missing page or file";
    }

    @Override
    public String description() {
        return "A link (a href, iframe src) points to a path of this site that the build doesn't publish, or a reference "
                + "in the content points to an asset that no longer exists (it renders an empty link). Relative, "
                + "root-relative and absolute links under the target's base URL are checked; external links are not. "
                + "Fix the link in the content or the template, or restore the target.";
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (LinkScan.Link link : LinkScan.internalLinks(site)) {
            if (!link.media() && missing(site, link.target()) && LinkScan.firstOf(seen, link)) {
                findings.add(context.finding(link.key(), link.ref().selector(),
                        "Link to " + LinkScan.written(link) + ": no page or file of this build is there."));
            }
        }
        for (Map.Entry<IndexedOutput, ReferenceEvent> entry : LinkScan.events(site, ReferenceEvent.Kind.MISSING)) {
            ReferenceEvent event = entry.getValue();
            findings.add(context.finding(entry.getKey().key(), null,
                    "Reference to a " + LinkScan.kindName(event.targetKind()) + " that doesn't exist (" + event.target()
                            + ")" + LinkScan.field(event) + ": it renders an empty link."));
        }
        return findings;
    }

    /** Whether nothing of the build answers at {@code path}: no output, no held-back page, no redirect. */
    static boolean missing(SiteIndex site, String path) {
        return site.output(path).isEmpty() && !site.isHeldBack(path) && !site.isRedirectSource(path);
    }
}
