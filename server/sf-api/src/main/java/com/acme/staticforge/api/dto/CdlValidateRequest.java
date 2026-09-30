package com.acme.staticforge.api.dto;

/**
 * CDL validation request body (spec §14.7): the definition as its sections (M34), each the text inside its
 * {@code content}/{@code bodies}/{@code rules} braces. Omitted sections are empty.
 */
public record CdlValidateRequest(String contentCdl, String bodiesCdl, String rulesCdl) {}
