package com.acme.staticforge.asset.rules;

import com.acme.staticforge.asset.content.ContentIssue;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * The findings a save produced beyond the stored draft's own (M33.4): a change to a read-only field it ignored
 * ({@code read-only} infos) and the save scope's warnings and infos. A save's service call returns its stored version
 * as before; a caller that wants these wraps the call in {@link #capture}, which collects what the save rule gate
 * {@link #add}s on the same thread. Outside a capture, {@link #add} does nothing.
 */
public final class SaveFindings {

    private static final ThreadLocal<List<ContentIssue>> CURRENT = new ThreadLocal<>();

    private SaveFindings() {}

    /** A value and the findings the saves inside produced. */
    public record Captured<T>(T value, List<ContentIssue> findings) {}

    /** Runs {@code save}, collecting the findings of every save it makes. Nested captures collect into the outer one. */
    public static <T> Captured<T> capture(Supplier<T> save) {
        List<ContentIssue> outer = CURRENT.get();
        List<ContentIssue> collected = new ArrayList<>();
        CURRENT.set(collected);
        try {
            T value = save.get();
            return new Captured<>(value, List.copyOf(collected));
        } finally {
            if (outer == null) {
                CURRENT.remove();
            } else {
                outer.addAll(collected);
                CURRENT.set(outer);
            }
        }
    }

    /** Records findings of a save, when a caller is capturing. */
    static void add(List<ContentIssue> findings) {
        List<ContentIssue> current = CURRENT.get();
        if (current != null) {
            current.addAll(findings);
        }
    }
}
