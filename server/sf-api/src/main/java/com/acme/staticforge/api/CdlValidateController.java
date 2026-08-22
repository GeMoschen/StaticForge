package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.CdlValidateRequest;
import com.acme.staticforge.api.dto.CdlValidateResponse;
import com.acme.staticforge.template.cdl.CdlCompiler;
import com.acme.staticforge.template.cdl.CdlResult;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * CDL validation endpoint (spec §14.7, §20.2). Compiles arbitrary CDL and returns positioned
 * diagnostics so Monaco can render squiggles while typing; template saves re-run the same
 * compiler server-side.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/cdl")
public class CdlValidateController {

    private final CdlCompiler cdlCompiler = new CdlCompiler();

    @PostMapping(value = "/validate", produces = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public CdlValidateResponse validate(
            @PathVariable("projectKey") String projectKey, @RequestBody CdlValidateRequest body) {
        CdlResult result = cdlCompiler.compile(body.source());
        return new CdlValidateResponse(result.diagnostics());
    }
}
