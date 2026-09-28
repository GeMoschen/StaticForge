package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0105} "Link to a deleted asset" (M30.2.1): a reference to a page, media file, folder or section
 * template that is deleted at the build revision ({@code SF-GEN-0220}); it renders empty.
 */
@Component
public class DeletedTargetRule extends UnresolvedReferenceRule {

    public static final String CODE = "SF-CHK-0105";

    public DeletedTargetRule() {
        super(ReferenceEvent.Kind.DELETED);
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public String name() {
        return "Link to a deleted asset";
    }

    @Override
    public String description() {
        return "The content or the template references a page, media file, folder or section template that has been "
                + "deleted, so the reference renders empty. Restore the target from the trash, or remove the "
                + "reference from the field the finding names.";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT_OR_TEMPLATE;
    }

    @Override
    String message(String target) {
        return "Link to deleted " + target + ": it renders empty.";
    }
}
