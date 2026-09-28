package com.acme.staticforge.generate.quality;

import java.util.List;

/**
 * A page-local quality rule (M30, epic decision 3): it looks at one parsed HTML output. The output is parsed once and
 * every page rule works on that one document, on the render's virtual-thread pool (epic decision 11) — so a rule must
 * be stateless and thread-safe, and must not change the document.
 *
 * <p>Page rules also run outside a build, on a page's draft render (draft checks, M30.3.1): read what other outputs
 * exist through {@link RuleContext#environment()}, never from anywhere else.
 */
public interface PageRule extends QualityRule {

    /**
     * The findings on {@code output}, created with {@link RuleContext#finding}; empty when it passes.
     *
     * @param context this rule's effective configuration and the finding factory, bound to {@code output}
     */
    List<Finding> check(ParsedOutput output, RuleContext context);
}
