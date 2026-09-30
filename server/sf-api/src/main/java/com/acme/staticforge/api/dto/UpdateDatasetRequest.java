package com.acme.staticforge.api.dto;

import java.util.Map;

/**
 * Replace a dataset schema (M19.2.1); send every field, as read. {@code channelTemplates} (M25.2.1) maps a channel key
 * to its OCTL record template source and replaces the stored ones (a blank source or a missing key removes a channel's
 * template); omitted, the stored record templates are kept and recompiled against the schema. The CDL comes as two
 * sections (M34): {@code contentCdl} and {@code rulesCdl}, each the text inside its {@code content}/{@code rules}
 * braces.
 */
public record UpdateDatasetRequest(
        String displayName,
        String contentCdl,
        String rulesCdl,
        String titleEditor,
        String description,
        Map<String, String> channelTemplates,
        String comment) {}
