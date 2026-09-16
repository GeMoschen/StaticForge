package com.acme.staticforge.api.dto;

/**
 * OCTL validation request body (spec §20.2). With {@code templateUuid} the source is validated as that
 * template's channel (M20.4.1): references resolve against the project, a page template's chain is linked and
 * names are checked against its effective definition, using {@code contentDefinition} (unsaved CDL source) when
 * given, otherwise the template's stored CDL.
 */
public record OctlValidateRequest(String source, String channelKey, String templateUuid, String contentDefinition) {}
