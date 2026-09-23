package com.acme.staticforge.api.dto;

import java.util.UUID;

/** The identity of a related asset (M25): a record set's dataset, a record's set. */
public record AssetRefView(UUID uuid, String uid, String displayName) {}
