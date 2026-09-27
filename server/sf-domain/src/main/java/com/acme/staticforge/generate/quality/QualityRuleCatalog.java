package com.acme.staticforge.generate.quality;

import java.util.Set;

/**
 * The codes of the quality rules this build knows (M30.1.2), for code outside the generation module that must tell a
 * known rule from an unknown one — the project import drops the configuration of rules it doesn't know. Implemented by
 * the rule registry in {@code sf-generate}.
 */
public interface QualityRuleCatalog {

    /** Every registered rule code ({@code SF-CHK-0xyz}). */
    Set<String> codes();
}
