package com.acme.staticforge.common;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Pure URL-slug normalization used by {@code UidGenerator} (spec §6.3, steps 1–5).
 * NFKD-normalizes, transliterates common ligatures, strips combining marks, lowercases,
 * collapses non-{@code [a-z0-9]} runs to a single underscore, and truncates to 96 chars.
 * Uniqueness and reserved-word handling live in {@code UidGenerator} (they need the
 * project + asset type context).
 */
public final class Slugifier {

    public String slug(String displayName) {
        String s = displayName == null ? "" : displayName;

        // 1+2. Unicode NFKD decomposition (Ä -> A + combining diaeresis) and
        // transliteration of the ligatures that survive NFKD.
        s = Normalizer.normalize(s, Normalizer.Form.NFKD);
        s = s.replace("ß", "ss")
                .replace("æ", "ae")
                .replace("œ", "oe")
                .replace("ø", "o")
                .replace("ł", "l")
                .replace("đ", "d")
                .replace("ð", "d")
                .replace("þ", "th");

        // 3. Strip combining marks (the diaeresis left by NFKD).
        s = s.replaceAll("\\p{M}", "");

        // 4. Lowercase; 5. collapse non [a-z0-9] runs to a single underscore; trim.
        s = s.toLowerCase(Locale.ROOT);
        s = s.replaceAll("[^a-z0-9]+", "_");
        s = s.replaceAll("^_+|_+$", "");

        // 6. Truncate to 96 chars, cutting at the last underscore when it loses ≤ 12 chars.
        if (s.length() > 96) {
            String cut = s.substring(0, 96);
            int lastUnderscore = cut.lastIndexOf('_');
            if (lastUnderscore >= 84) {
                cut = cut.substring(0, lastUnderscore);
            }
            s = cut;
        }
        return s;
    }
}
