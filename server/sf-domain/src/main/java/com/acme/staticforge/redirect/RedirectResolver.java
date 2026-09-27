package com.acme.staticforge.redirect;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Resolves redirects against the outputs of one build (M30, epic decision 16) — a pure function, used by the registry
 * view (against the default target's current build), by {@code for-asset} and manual validation, and by the build
 * itself (M30.4.2, against the new build's outputs). Per redirect, in this order:
 *
 * <ol>
 *   <li>its target: a page target is the page's output path in the redirect's channel and locale (none when the page
 *       has no output there); a fixed target is itself;
 *   <li>{@link RedirectState#LOOP} when the target's path is the source path itself;
 *   <li>{@link RedirectState#SHADOWED} when a page or media file of the build lives at the source path;
 *   <li>{@link RedirectState#DANGLING} when the target page has no output;
 *   <li>{@link RedirectState#LOOP} when following the target through the other emitted redirects of the same channel
 *       and locale never ends (a cycle, or a way into one);
 *   <li>otherwise {@link RedirectState#ACTIVE}.
 * </ol>
 *
 * <p>Chains of fixed targets are not collapsed: each redirect is one hop, as its owner wrote it. Page targets never
 * chain — a page's output path is live, so a redirect from there is shadowed.
 */
public final class RedirectResolver {

    private RedirectResolver() {}

    /** Each of {@code rules} resolved against {@code outputs}, in the same order. */
    public static List<ResolvedRedirect> resolve(List<RedirectRule> rules, RedirectOutputs outputs) {
        int n = rules.size();
        String[] targets = new String[n];
        RedirectState[] states = new RedirectState[n];
        Map<SourceKey, Integer> emitted = new HashMap<>();
        for (int i = 0; i < n; i++) {
            RedirectRule rule = rules.get(i);
            String target = target(rule, outputs);
            targets[i] = target;
            if (target != null && rule.fromPath().equals(RedirectPaths.pathOf(target))) {
                states[i] = RedirectState.LOOP;
            } else if (outputs.isLive(rule.fromPath())) {
                states[i] = RedirectState.SHADOWED;
            } else if (target == null) {
                states[i] = RedirectState.DANGLING;
            } else {
                states[i] = RedirectState.ACTIVE;
                emitted.putIfAbsent(new SourceKey(rule.channel(), rule.locale(), rule.fromPath()), i);
            }
        }
        markCycles(rules, targets, states, emitted);
        List<ResolvedRedirect> resolved = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            resolved.add(new ResolvedRedirect(rules.get(i), states[i], targets[i]));
        }
        return resolved;
    }

    /** Only the redirects a build writes ({@link RedirectState#ACTIVE}), in the order of {@code rules}. */
    public static List<ResolvedRedirect> active(List<RedirectRule> rules, RedirectOutputs outputs) {
        return resolve(rules, outputs).stream().filter(ResolvedRedirect::active).toList();
    }

    /** Where {@code rule} leads in {@code outputs}; {@code null} when its target page has no output there. */
    public static String target(RedirectRule rule, RedirectOutputs outputs) {
        if (rule.toPath() != null) {
            return rule.toPath();
        }
        return outputs.pagePath(rule.toAssetUuid(), rule.channel(), rule.locale(), rule.pageNumber()).orElse(null);
    }

    /**
     * Marks every emitted redirect whose chain of fixed targets doesn't end as a loop — the members of a cycle and the
     * redirects leading into one. Each redirect is visited once: a walk stops at the first redirect whose outcome is
     * known and hands that outcome to the whole walk.
     */
    private static void markCycles(
            List<RedirectRule> rules, String[] targets, RedirectState[] states, Map<SourceKey, Integer> emitted) {
        int n = rules.size();
        // 0 = not visited, 1 = on the current walk, 2 = ends, 3 = loops
        int[] outcome = new int[n];
        for (int start = 0; start < n; start++) {
            if (states[start] != RedirectState.ACTIVE || outcome[start] != 0) {
                continue;
            }
            List<Integer> walk = new ArrayList<>();
            int current = start;
            int result = 2;
            while (true) {
                outcome[current] = 1;
                walk.add(current);
                String path = RedirectPaths.pathOf(targets[current]);
                RedirectRule rule = rules.get(current);
                Integer next = path == null ? null : emitted.get(new SourceKey(rule.channel(), rule.locale(), path));
                if (next == null) {
                    break;
                }
                if (outcome[next] == 1) {
                    result = 3;
                    break;
                }
                if (outcome[next] != 0) {
                    result = outcome[next];
                    break;
                }
                current = next;
            }
            for (int i : walk) {
                outcome[i] = result;
                if (result == 3) {
                    states[i] = RedirectState.LOOP;
                }
            }
        }
    }

    private record SourceKey(String channel, String locale, String path) {}
}
