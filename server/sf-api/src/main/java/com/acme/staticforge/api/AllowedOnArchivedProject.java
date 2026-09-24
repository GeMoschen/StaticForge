package com.acme.staticforge.api;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a {@code POST}/{@code PUT}/{@code PATCH}/{@code DELETE} handler under {@code /api/v1/projects/{key}} that
 * {@link ArchivedProjectInterceptor} lets through on an archived project (M26): a request that changes nothing (a
 * dry run, a validation, a preview), or one of the few writes an archived project admits (unarchiving it).
 *
 * <p>{@code ArchivedProjectEndpointWalkTest} lists every handler carrying it, so a new one is reviewed there.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface AllowedOnArchivedProject {

    /** Why this request may run on an archived project. */
    String value();
}
