package com.acme.staticforge.search;

import com.acme.staticforge.revision.RevisionCommittedEvent;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Requests a search index sync after a revision's transaction commits (M23.2.1). Runs on the committing thread, so it
 * only hands the project to {@link SearchIndexer}; a rolled-back transaction never gets here.
 */
@Component
public class SearchIndexingListener {

    private final SearchIndexer indexer;
    private final SearchProperties properties;
    private final Counter received;

    public SearchIndexingListener(SearchIndexer indexer, SearchProperties properties, MeterRegistry meters) {
        this.indexer = indexer;
        this.properties = properties;
        this.received = Counter.builder("sf.search.index.events")
                .description("Committed revisions handed to search indexing (M23.2.1).")
                .register(meters);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onRevisionCommitted(RevisionCommittedEvent event) {
        received.increment();
        if (properties.liveIndexing()) {
            indexer.requestSync(event.projectId());
        }
    }
}
