package com.acme.staticforge.search;

import java.util.Optional;
import java.util.OptionalInt;
import java.util.OptionalLong;

/**
 * What a project's index directory holds (M23.2.2), read from its latest commit.
 *
 * @param indexedRevision the revision stamp of the latest commit, empty when there is none
 * @param schemaVersion the {@link SearchSchemaVersion} of the latest commit, empty when there is none
 * @param owner the owner token of the latest commit, empty when there is none
 */
public record IndexCheck(Condition condition, OptionalLong indexedRevision, OptionalInt schemaVersion, Optional<String> owner) {

    public enum Condition {
        /** No commit yet. */
        MISSING,
        /** A readable commit. */
        PRESENT,
        /** Corrupt, or written by an incompatible Lucene version. */
        UNREADABLE,
        /** The index can't be opened by this instance (write lock held elsewhere). */
        UNAVAILABLE
    }

    public static IndexCheck of(Condition condition) {
        return new IndexCheck(condition, OptionalLong.empty(), OptionalInt.empty(), Optional.empty());
    }

    /** True when the index is readable, was written with the current document model and belongs to {@code owner}. */
    public boolean current(String expectedOwner) {
        return condition == Condition.PRESENT
                && indexedRevision.isPresent()
                && schemaVersion.isPresent()
                && schemaVersion.getAsInt() == SearchSchemaVersion.CURRENT
                && owner.filter(o -> o.equals(expectedOwner)).isPresent();
    }
}
