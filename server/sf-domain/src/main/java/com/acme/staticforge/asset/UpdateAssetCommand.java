package com.acme.staticforge.asset;

import com.fasterxml.jackson.databind.JsonNode;

/** Command to update an existing asset's mutable state (spec §21.3). */
public record UpdateAssetCommand(String displayName, JsonNode payload) {}
