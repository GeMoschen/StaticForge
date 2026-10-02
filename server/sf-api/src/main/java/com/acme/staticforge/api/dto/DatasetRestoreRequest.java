package com.acme.staticforge.api.dto;

/** Dataset restore body: {@code fromRevision} is optional (absent: the last live version of a deleted dataset). */
public record DatasetRestoreRequest(Long fromRevision) {}
