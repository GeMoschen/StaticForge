package com.acme.staticforge.api.dto;

import com.acme.staticforge.template.diagnostic.Diagnostic;
import java.util.List;

/** CDL validation result: positioned diagnostics for Monaco squiggles. */
public record CdlValidateResponse(List<Diagnostic> diagnostics) {}
