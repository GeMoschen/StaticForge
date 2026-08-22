package com.acme.staticforge.revision;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a class as the only place allowed to write through repositories. An ArchUnit
 * rule (spec §21.2) fails the build if a repository save/delete is called from a class
 * not carrying this annotation.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface RevisionAware {}
