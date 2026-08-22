package com.acme.staticforge.revision;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Pure field-path JSON differ: walks two JSON payloads and emits field-level changes using
 * dotted paths (spec §7.6).
 *
 * <p>Non-richtext leaf/array values are compared structurally. Rich text is stored as
 * {@code {"format":"html","value":"<p>…</p>…"}}; when both sides are rich text the HTML is
 * split into blocks and diffed per block (see {@link HtmlBlockSplitter}), so the emitted
 * {@link FieldChange} carries {@link FieldChange#blocks()} rather than an opaque whole-field
 * change.
 */
public final class JsonDiffer {

    private JsonDiffer() {}

    public static List<FieldChange> diff(JsonNode before, JsonNode after) {
        List<FieldChange> changes = new ArrayList<>();
        walk(before, after, "", changes);
        return changes;
    }

    private static void walk(JsonNode a, JsonNode b, String path, List<FieldChange> out) {
        boolean aAbsent = a == null || a.isMissingNode() || a.isNull();
        boolean bAbsent = b == null || b.isMissingNode() || b.isNull();

        if (aAbsent && bAbsent) {
            return;
        }
        if (aAbsent) {
            out.add(new FieldChange(path, null, b));
            return;
        }
        if (bAbsent) {
            out.add(new FieldChange(path, a, null));
            return;
        }

        if (isRichtext(a) && isRichtext(b)) {
            diffRichtext(a, b, path, out);
            return;
        }

        if (a.isObject() && b.isObject()) {
            Set<String> keys = new LinkedHashSet<>();
            a.fieldNames().forEachRemaining(keys::add);
            b.fieldNames().forEachRemaining(keys::add);
            for (String key : keys) {
                walk(a.get(key), b.get(key), path.isEmpty() ? key : path + "." + key, out);
            }
            return;
        }
        if (a.isArray() && b.isArray()) {
            if (!a.equals(b)) {
                out.add(new FieldChange(path, a, b));
            }
            return;
        }
        if (!a.equals(b)) {
            out.add(new FieldChange(path, a, b));
        }
    }

    /** Rich text is {@code {"format":"html","value":"…"}}; markdown is a plain string, never this shape. */
    private static boolean isRichtext(JsonNode node) {
        return node != null
                && node.isObject()
                && node.has("format")
                && "html".equals(node.path("format").asText())
                && node.has("value")
                && node.get("value").isTextual();
    }

    private static void diffRichtext(JsonNode a, JsonNode b, String path, List<FieldChange> out) {
        String oldHtml = a.get("value").asText("");
        String newHtml = b.get("value").asText("");
        if (oldHtml.equals(newHtml)) {
            return;
        }
        List<BlockChange> blocks = diffBlocks(
                HtmlBlockSplitter.splitBlocks(oldHtml), HtmlBlockSplitter.splitBlocks(newHtml));
        if (!blocks.isEmpty()) {
            out.add(new FieldChange(path, a, b, blocks));
        }
    }

    /**
     * Longest-common-subsequence diff of two block lists, yielding {@code ADD}/{@code REMOVE}
     * operations which are then normalized: a removal immediately followed by an addition at the
     * same position becomes an in-place {@code UPDATE}.
     */
    private static List<BlockChange> diffBlocks(List<String> before, List<String> after) {
        int m = before.size();
        int n = after.size();
        int[][] lcs = new int[m + 1][n + 1];
        for (int i = m - 1; i >= 0; i--) {
            for (int j = n - 1; j >= 0; j--) {
                if (before.get(i).equals(after.get(j))) {
                    lcs[i][j] = lcs[i + 1][j + 1] + 1;
                } else {
                    lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
                }
            }
        }

        List<BlockChange> ops = new ArrayList<>();
        int i = 0;
        int j = 0;
        while (i < m && j < n) {
            if (before.get(i).equals(after.get(j))) {
                i++;
                j++;
            } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
                ops.add(new BlockChange(i, BlockChange.REMOVE, before.get(i), null));
                i++;
            } else {
                ops.add(new BlockChange(j, BlockChange.ADD, null, after.get(j)));
                j++;
            }
        }
        while (i < m) {
            ops.add(new BlockChange(i, BlockChange.REMOVE, before.get(i), null));
            i++;
        }
        while (j < n) {
            ops.add(new BlockChange(j, BlockChange.ADD, null, after.get(j)));
            j++;
        }
        return normalize(ops);
    }

    /** Merges a removal immediately followed by an addition at the same position into an in-place update. */
    private static List<BlockChange> normalize(List<BlockChange> ops) {
        List<BlockChange> merged = new ArrayList<>(ops.size());
        for (int k = 0; k < ops.size(); k++) {
            BlockChange op = ops.get(k);
            if (op.kind().equals(BlockChange.REMOVE) && k + 1 < ops.size()) {
                BlockChange next = ops.get(k + 1);
                if (next.kind().equals(BlockChange.ADD) && next.index() == op.index()) {
                    merged.add(new BlockChange(op.index(), BlockChange.UPDATE, op.before(), next.after()));
                    k++;
                    continue;
                }
            }
            merged.add(op);
        }
        return List.copyOf(merged);
    }
}
