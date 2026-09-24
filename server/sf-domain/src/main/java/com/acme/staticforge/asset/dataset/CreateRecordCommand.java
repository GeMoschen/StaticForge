package com.acme.staticforge.asset.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/**
 * Command to create a dataset record (M19.1.2) — an entry of the record set {@code recordSetUuid}, whose
 * dataset it takes (M25); there is no record outside a set. A record has no name of its own to give: its
 * display name and uid are derived (see {@link RecordService#create}).
 */
public record CreateRecordCommand(long projectId, UUID recordSetUuid, JsonNode content) {}
