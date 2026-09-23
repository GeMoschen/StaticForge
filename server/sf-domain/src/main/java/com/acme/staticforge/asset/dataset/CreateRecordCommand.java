package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Command to create a dataset record (M19.1.2) — an entry of the record set {@code recordSetUuid}, whose
 * dataset it takes (M25); there is no record outside a set. {@code displayName} may be blank when the
 * dataset has a title editor whose value is set.
 */
public record CreateRecordCommand(long projectId, UUID recordSetUuid, String displayName, JsonNode content) {}
