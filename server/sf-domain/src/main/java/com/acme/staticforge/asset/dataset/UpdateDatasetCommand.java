package com.acme.staticforge.asset.dataset;

/** Command to replace a dataset schema's editable fields (M19.1.2); every field is written as given. */
public record UpdateDatasetCommand(String displayName, String contentDefinition, String titleEditor, String description) {}
