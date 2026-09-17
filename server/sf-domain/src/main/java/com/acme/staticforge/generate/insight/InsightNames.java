package com.acme.staticforge.generate.insight;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Reads the stored name of an insight enum tolerantly: a plan written by a newer build must stay readable. */
final class InsightNames {

    private static final Logger log = LoggerFactory.getLogger(InsightNames.class);

    private InsightNames() {}

    static <E extends Enum<E>> E parse(Class<E> type, String name, E unknown) {
        if (name == null || name.isBlank()) {
            return unknown;
        }
        try {
            return Enum.valueOf(type, name);
        } catch (IllegalArgumentException e) {
            log.debug("Unknown {} '{}' read as {}", type.getSimpleName(), name, unknown);
            return unknown;
        }
    }
}
