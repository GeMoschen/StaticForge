package com.acme.staticforge.asset.template;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;
import java.util.UUID;

/**
 * What a page template save would do to one descendant template (M20.2.2): its diagnostics for one channel, or
 * for its content definition when {@code channel} is {@code null}.
 */
public record DescendantIssue(UUID uuid, String uid, String channel, List<Diagnostic> diagnostics) {

    public DescendantIssue {
        diagnostics = List.copyOf(diagnostics);
    }
}
