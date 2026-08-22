package com.acme.staticforge.api;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
