package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.query.RecordSetQuery;

/**
 * Change a record set (M25.3.1): its display name (blank keeps it) and its stored query, which is replaced
 * as a whole ({@code null}: every record, default order). The dataset cannot be changed.
 */
public record UpdateRecordSetRequest(String displayName, RecordSetQuery query, String comment) {}
