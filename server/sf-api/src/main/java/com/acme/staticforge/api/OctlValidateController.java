package com.acme.staticforge.api;

import com.acme.staticforge.api.dto.OctlValidateRequest;
import com.acme.staticforge.api.dto.OctlValidateResponse;
import com.acme.staticforge.template.octl.OctlCompiler;
import com.acme.staticforge.template.octl.OctlResult;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * OCTL validation endpoint (spec §16.11, §20.2). Compiles arbitrary OCTL and returns
 * positioned diagnostics so the editor can render squiggles while typing. Reference
 * resolution and scope/name checks against the template's content definition are skipped
 * here (they require the domain layer and the template's resolved definition); the returned
 * diagnostics therefore cover the structural catalogue (unknown instruction, unbalanced
 * block, unknown filter) and {@code $CMS_BODY} placement.
 */
@RestController
@RequestMapping("/api/v1/projects/{projectKey}/octl")
public class OctlValidateController {

    private final OctlCompiler octlCompiler = new OctlCompiler();

    @PostMapping(value = "/validate", produces = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.DEVELOPER + ")")
    public OctlValidateResponse validate(
            @PathVariable("projectKey") String projectKey, @RequestBody OctlValidateRequest body) {
        OctlResult result = octlCompiler.compile(body.source(), body.channelKey(), null);
        return new OctlValidateResponse(result.diagnostics());
    }
}
