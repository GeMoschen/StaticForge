package com.acme.staticforge.generate.quality;

import java.util.List;

/**
 * A site-wide quality rule (M30, epic decision 3): it looks at the facts of every output of the build — new and
 * carried — through the {@link SiteIndex}, never at a document. Site rules run once per build, after every page rule;
 * they always run over the whole site, also in an incremental run (carried outputs' facts come from the base build's
 * sidecar).
 *
 * <p><b>No cascade (epic decision 6).</b> Rules run in two phases: first every page rule and every site rule that
 * doesn't {@linkplain #afterHoldBack() wait for the hold-back}; their {@code ERROR} findings hold pages back; then the
 * rules that look at the held-back set run. Those can't hold anything back themselves: their severity is capped at
 * {@code WARNING}, so holding one page back never holds back the pages that link to it.
 */
public interface SiteRule extends QualityRule {

    /**
     * The findings over the whole build, each created with {@link RuleContext#finding(OutputKey, String, String)} on
     * the output it concerns; empty when the site passes.
     */
    List<Finding> check(SiteIndex site, RuleContext context);

    /** Whether the rule reads {@link SiteIndex#heldBack()} and therefore runs after the hold-back. */
    default boolean afterHoldBack() {
        return false;
    }

    /** {@code WARNING} for a rule that runs after the hold-back; else {@code ERROR}. */
    @Override
    default QualitySeverity maxSeverity() {
        return afterHoldBack() ? QualitySeverity.WARNING : QualitySeverity.ERROR;
    }
}
