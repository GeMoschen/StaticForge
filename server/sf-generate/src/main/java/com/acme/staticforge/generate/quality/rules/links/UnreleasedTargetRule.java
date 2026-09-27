package com.acme.staticforge.generate.quality.rules.links;

import com.acme.staticforge.generate.quality.QualityFixHint;
import com.acme.staticforge.generate.quality.ReferenceEvent;
import org.springframework.stereotype.Component;

/**
 * {@code SF-CHK-0104} "Link to an unreleased asset" (M30.2.1): a reference to a page, media file or folder that exists
 * but isn't released in the language the build renders (M27, {@code SF-GEN-0221}); it renders an empty link.
 */
@Component
public class UnreleasedTargetRule extends UnresolvedReferenceRule {

    public static final String CODE = "SF-CHK-0104";

    public UnreleasedTargetRule() {
        super(ReferenceEvent.Kind.UNRELEASED);
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public String name() {
        return "Link to an unreleased asset";
    }

    @Override
    public String description() {
        return "The content or the template references a page, media file or folder that isn't released (never "
                + "released, or unpublished), so the reference renders an empty link. Release the target, or remove "
                + "the reference from the field the finding names.";
    }

    @Override
    public QualityFixHint fixHint() {
        return QualityFixHint.CONTENT_OR_TEMPLATE;
    }

    @Override
    String message(String target) {
        return "Link to unreleased " + target + ": it renders an empty link until the target is released.";
    }
}
