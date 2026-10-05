package com.acme.staticforge.asset;

import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The display name of a duplicate: "&lt;name&gt; copy", then "&lt;name&gt; copy 2", ... — the first one no
 * sibling already has (case-insensitive), kept within the display name limit by shortening the original.
 */
public final class CopyNames {

    private static final int MAX_DISPLAY_NAME = 200;

    private CopyNames() {}

    public static String free(String name, Collection<String> siblingNames) {
        Set<String> taken = new HashSet<>();
        siblingNames.forEach(sibling -> taken.add(sibling.toLowerCase(Locale.ROOT)));
        for (int n = 1; ; n++) {
            String suffix = n == 1 ? " copy" : " copy " + n;
            String base = name.length() + suffix.length() > MAX_DISPLAY_NAME
                    ? name.substring(0, MAX_DISPLAY_NAME - suffix.length())
                    : name;
            String candidate = base + suffix;
            if (!taken.contains(candidate.toLowerCase(Locale.ROOT))) {
                return candidate;
            }
        }
    }
}
