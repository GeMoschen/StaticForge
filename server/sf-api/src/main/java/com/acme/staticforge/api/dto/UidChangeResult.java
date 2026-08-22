package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * Change-UID response: the old/new UID plus the informational warning listing OCTL templates
 * that still reference the old UID literally (spec §6.4).
 */
public record UidChangeResult(
        String oldUid,
        String newUid,
        List<AffectedTemplate> affectedTemplates) {}
