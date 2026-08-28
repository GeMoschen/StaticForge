package com.acme.staticforge.revision;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * {@link RevisionServiceImpl} tests against mock collaborators (`M15.1.1`) — focuses on
 * {@link RevisionService#allocateOrJoin}'s two branches: the fresh-allocate branch used by
 * every standalone (non-batch) call site, and the join branch that a compound revision's
 * nested calls take, which must not touch {@link RevisionCounterRepository} at all (the
 * core "no extra counter increment" guarantee compound revisions depend on).
 */
class RevisionServiceImplTest {

    private static final long PROJECT_ID = 7L;

    private RevisionCounterRepository counterRepository;
    private RevisionRepository revisionRepository;
    private RevisionServiceImpl service;

    @BeforeEach
    void setUp() {
        counterRepository = mock(RevisionCounterRepository.class);
        revisionRepository = mock(RevisionRepository.class);
        service = new RevisionServiceImpl(
                counterRepository, revisionRepository, new ObjectMapper(), new SimpleMeterRegistry());

        when(counterRepository.nextRevision(anyLong())).thenReturn(1L);
        when(revisionRepository.save(any(Revision.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void allocateOrJoin_withoutOpenRevision_allocatesFreshRevision() {
        RevisionContext ctx = RevisionContext.of(PROJECT_ID, 5L, "comment");

        Revision revision = service.allocateOrJoin(ctx, ChangeType.CREATE);

        assertThat(revision.getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(revision.getRevisionId()).isEqualTo(1L);
        assertThat(revision.getChangeType()).isEqualTo(ChangeType.CREATE);
        verify(counterRepository).nextRevision(PROJECT_ID);
    }

    @Test
    void allocateOrJoin_withOpenRevision_returnsSameInstanceWithoutAllocating() {
        Revision batch = new Revision(
                PROJECT_ID, 9L, Instant.now(), 5L, ChangeType.CREATE, "batch", new ObjectMapper().createObjectNode());
        RevisionContext ctx = RevisionContext.joining(batch, 5L, "comment");

        Revision joined = service.allocateOrJoin(ctx, ChangeType.MOVE);

        assertThat(joined).isSameAs(batch);
        assertThat(joined.getChangeType()).isEqualTo(ChangeType.CREATE);
        verify(counterRepository, never()).nextRevision(anyLong());
        verify(revisionRepository, never()).save(any());
    }

    @Test
    void beginBatch_allocatesExactlyLikeAllocate() {
        Revision batch = service.beginBatch(PROJECT_ID, ChangeType.CREATE, "comment", 5L);

        assertThat(batch.getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(batch.getChangeType()).isEqualTo(ChangeType.CREATE);
        verify(counterRepository).nextRevision(PROJECT_ID);
    }
}
