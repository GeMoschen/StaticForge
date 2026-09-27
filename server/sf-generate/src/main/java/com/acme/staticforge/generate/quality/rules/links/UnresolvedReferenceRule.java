package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.Finding;
import com.acme.staticforge.generate.quality.IndexedOutput;
import com.acme.staticforge.generate.quality.QualityCategory;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import com.acme.staticforge.generate.quality.RuleContext;
import com.acme.staticforge.generate.quality.SiteIndex;
import com.acme.staticforge.generate.quality.SiteRule;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A link rule over the renderer's reference events of one {@link ReferenceEvent.Kind} (M30.2.1, epic decision 8): the
 * reference rendered {@code ""}, so the HTML no longer says where it pointed — the finding is on the output that
 * rendered it and names the target (uid or display name, asset type, language) and the field that holds the reference.
 * The finding has no selector: the event doesn't know the element.
 */
abstract class UnresolvedReferenceRule implements SiteRule {

    private final ReferenceEvent.Kind kind;

    UnresolvedReferenceRule(ReferenceEvent.Kind kind) {
        this.kind = kind;
    }

    @Override
    public QualityCategory category() {
        return QualityCategory.LINKS;
    }

    @Override
    public List<Finding> check(SiteIndex site, RuleContext context) {
        List<Finding> findings = new ArrayList<>();
        for (Map.Entry<IndexedOutput, ReferenceEvent> entry : LinkScan.events(site, kind)) {
            findings.add(context.finding(entry.getKey().key(), null,
                    message(LinkScan.target(context.environment(), entry.getValue()))));
        }
        return findings;
    }

    /** The message about the reference to {@code target} ({@code page 'about' (PAGE) in field content.cta}). */
    abstract String message(String target);
}
