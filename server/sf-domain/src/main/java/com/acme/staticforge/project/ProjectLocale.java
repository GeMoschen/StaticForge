package com.acme.staticforge.project;

/**
 * One declared content locale of a project (spec §2.2 as revised by M24): a canonical BCP 47
 * language tag plus a free-text label shown to editors.
 */
public record ProjectLocale(String code, String label) {}
