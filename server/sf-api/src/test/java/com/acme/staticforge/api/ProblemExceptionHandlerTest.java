package com.acme.staticforge.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.acme.staticforge.common.Problem;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.orm.ObjectOptimisticLockingFailureException;

class ProblemExceptionHandlerTest {

    @Test
    @DisplayName("a @Version conflict at commit is 409 SF-API-0409, like a stale If-Match (M27.4.4)")
    void optimisticLockIsConflict() {
        ResponseEntity<Problem> response = new ProblemExceptionHandler()
                .handleOptimisticLock(new ObjectOptimisticLockingFailureException("ScheduledAction", 1L));
        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getBody().getExtensions()).containsEntry("code", "SF-API-0409");
    }
}
