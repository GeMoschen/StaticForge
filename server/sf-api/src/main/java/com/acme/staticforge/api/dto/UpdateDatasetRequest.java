package com.acme.staticforge.api.dto;

/** Replace a dataset schema (M19.2.1); send every field, as read. */
public record UpdateDatasetRequest(
        String displayName, String contentDefinition, String titleEditor, String description, String comment) {}
