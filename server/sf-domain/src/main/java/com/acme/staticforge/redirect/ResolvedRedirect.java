package com.acme.staticforge.redirect;

/**
 * A redirect resolved against one set of outputs ({@link RedirectResolver}).
 *
 * @param rule the redirect
 * @param state what it does there
 * @param target where it leads there: the target page's output path in the redirect's channel and locale, or the fixed
 *     target (an output path, possibly with query and fragment, or an absolute URL); {@code null} when the target page
 *     has no output ({@link RedirectState#DANGLING})
 */
public record ResolvedRedirect(RedirectRule rule, RedirectState state, String target) {

    /** Whether the build writes this redirect. */
    public boolean active() {
        return state == RedirectState.ACTIVE;
    }
}
