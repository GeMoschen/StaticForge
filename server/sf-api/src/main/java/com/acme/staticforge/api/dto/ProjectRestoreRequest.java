package com.acme.staticforge.api.dto;

/** Project-wide rollback request (spec §7.6). */
public record ProjectRestoreRequest(Long toRevision) {}
