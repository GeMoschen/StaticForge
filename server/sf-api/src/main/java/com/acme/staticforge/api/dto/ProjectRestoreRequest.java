package com.acme.staticforge.api.dto;

/**
 * Project-wide rollback request (spec §7.6). {@code comment} is optional (at most 500 characters); the revision gets
 * "Project restore to N" when it is left out or blank.
 */
public record ProjectRestoreRequest(Long toRevision, String comment) {}
