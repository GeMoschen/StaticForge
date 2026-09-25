package com.acme.staticforge.api;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Translates exceptions into RFC 9457 problem documents so every API error conforms to
 * the catalogue in spec Appendix B.
 */
@RestControllerAdvice
public class ProblemExceptionHandler {

    @ExceptionHandler(SfException.class)
    public ResponseEntity<Problem> handleSfException(SfException ex) {
        return respond(ex.getProblem(), ex.getStatus());
    }

    /**
     * A method-security refusal ({@code @PreAuthorize("hasAuthority(...)")}) thrown out of a controller. Without this
     * the catch-all below would turn it into a 500; the filter chain's own access-denied handler never sees it.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Problem> handleAccessDenied(AccessDeniedException ex) {
        return respond(ProblemFactory.forbidden("Access denied."), HttpStatus.FORBIDDEN.value());
    }

    /**
     * A concurrent change caught by an entity's {@code @Version} at commit (a schedule edited while a scheduler node
     * claimed it, M27.4.4): the same {@code 409 SF-API-0409} a stale {@code If-Match} gets — reload and retry.
     */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<Problem> handleOptimisticLock(OptimisticLockingFailureException ex) {
        return respond(ProblemFactory.conflict("It was changed at the same time by someone else; reload it and try again."),
                HttpStatus.CONFLICT.value());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Problem> handleValidation(MethodArgumentNotValidException ex) {
        String detail = ex.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .findFirst()
                .orElse("Request validation failed.");
        return respond(ProblemFactory.badRequest(detail), HttpStatus.BAD_REQUEST.value());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Problem> handleGeneric(Exception ex) {
        Problem problem = Problem.builder()
                .type("https://cms.example.com/problems/internal")
                .title("Internal Server Error")
                .status(HttpStatus.INTERNAL_SERVER_ERROR.value())
                .property("code", "SF-API-0500")
                .build();
        return respond(problem, HttpStatus.INTERNAL_SERVER_ERROR.value());
    }

    private static ResponseEntity<Problem> respond(Problem problem, int status) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(problem);
    }
}
