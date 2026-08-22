package com.acme.staticforge.structure;

/**
 * The starting point of a structure's page collection (spec §17.1). {@code ref} is the page
 * UID when {@link #kind()} is {@link RootKind#PAGE}, or the folder path string (for example
 * {@code "/products/"}) when it is {@link RootKind#FOLDER}.
 */
public record StructureRoot(RootKind kind, String ref) {

    public StructureRoot {
        ref = ref == null ? "" : ref;
    }
}
