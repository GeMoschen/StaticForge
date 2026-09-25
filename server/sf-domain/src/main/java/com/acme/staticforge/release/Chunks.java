package com.acme.staticforge.release;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Function;

/**
 * Splits an {@code IN (…)} parameter list into bounded chunks: PostgreSQL caps a statement at 32,767 bind
 * parameters, and a 50,000-asset project (§26.2) would exceed it in one query.
 */
public final class Chunks {

    static final int SIZE = 1_000;

    private Chunks() {}

    public static <I, O> List<O> flatMap(Collection<I> ids, Function<List<I>, List<O>> query) {
        List<I> all = List.copyOf(ids);
        if (all.size() <= SIZE) {
            return query.apply(all);
        }
        List<O> out = new ArrayList<>();
        for (int from = 0; from < all.size(); from += SIZE) {
            out.addAll(query.apply(all.subList(from, Math.min(all.size(), from + SIZE))));
        }
        return out;
    }
}
