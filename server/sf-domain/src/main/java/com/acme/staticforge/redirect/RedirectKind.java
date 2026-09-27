package com.acme.staticforge.redirect;

/** Where a redirect came from (M30, epic decision 14). */
public enum RedirectKind {
    /** Detected by a build: an output's path changed (M30.4.2). A later detection may replace it. */
    AUTO,
    /** Added or edited by a person. Detection never touches it. */
    MANUAL
}
