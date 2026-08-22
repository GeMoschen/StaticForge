package com.acme.staticforge.asset;

/** Kind of a materialized outgoing asset reference (spec §5.4). */
public enum ReferenceKind {
    TEMPLATE,
    CONTENT_REF,
    MEDIA_REF,
    OCTL_VALUE,
    OCTL_REF,
    OCTL_INCLUDE,
    NAV
}
