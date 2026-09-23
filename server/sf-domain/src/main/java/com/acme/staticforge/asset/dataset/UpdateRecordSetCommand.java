package com.acme.staticforge.asset.dataset;

import com.acme.staticforge.template.query.RecordSetQuery;

/**
 * Command to change a record set (M25): its display name ({@code null} or blank keeps the current one)
 * and its stored query ({@code null} is {@link RecordSetQuery#ALL}). There is deliberately no dataset:
 * a set's dataset never changes.
 */
public record UpdateRecordSetCommand(String displayName, RecordSetQuery query) {}
