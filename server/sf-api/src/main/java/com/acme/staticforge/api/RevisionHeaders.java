package com.acme.staticforge.api;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;

/**
 * HTTP {@code ETag} / {@code If-Match} helpers for the revision-safety protocol (§7.5,
 * §20.1). Reads emit {@code ETag: "rev-{validFromRevision}"}; mutations parse
 * {@code If-Match: "rev-N"} back into the expected revision.
 */
final class RevisionHeaders {

    private RevisionHeaders() {}

    static String etag(long validFromRevision) {
        return "\"rev-" + validFromRevision + "\"";
    }

    static long expectedRevision(String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank()) {
            throw new SfException(ProblemFactory.other(
                    412, "SF-API-0412", "Precondition Failed", "If-Match header is required on mutating requests."));
        }
        String value = ifMatch.trim();
        if (value.startsWith("\"rev-") && value.endsWith("\"") && value.length() > 6) {
            try {
                return Long.parseLong(value.substring(5, value.length() - 1));
            } catch (NumberFormatException e) {
                throw new SfException(ProblemFactory.badRequest("Invalid If-Match header: " + ifMatch));
            }
        }
        throw new SfException(ProblemFactory.badRequest("Invalid If-Match header: " + ifMatch));
    }
}
