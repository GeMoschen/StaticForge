package com.acme.staticforge;

import java.util.Locale;
import org.hibernate.resource.jdbc.spi.StatementInspector;

/**
 * Counts the SQL statements Hibernate prepares on the <em>current thread</em> while counting is on — for tests that
 * assert how many statements a call runs. Hibernate's own statistics are global to the session factory, so the
 * scheduler's poll or the search indexer running in the same context would add their queries to any window.
 *
 * <p>Registered per test context with {@code spring.jpa.properties.hibernate.session_factory.statement_inspector=
 * com.acme.staticforge.ThreadStatementCounter}. Returns every statement unchanged.
 */
public class ThreadStatementCounter implements StatementInspector {

    private static final ThreadLocal<Counts> COUNTS = new ThreadLocal<>();

    /** Statements prepared on one thread, split into reads and writes. */
    public static final class Counts {
        private long selects;
        private long inserts;
        private long other;

        public long selects() {
            return selects;
        }

        public long inserts() {
            return inserts;
        }

        public long other() {
            return other;
        }
    }

    /** Counts the statements {@code call} prepares on this thread. */
    public static Counts during(Runnable call) {
        Counts counts = new Counts();
        COUNTS.set(counts);
        try {
            call.run();
        } finally {
            COUNTS.remove();
        }
        return counts;
    }

    @Override
    public String inspect(String sql) {
        Counts counts = COUNTS.get();
        if (counts != null) {
            String statement = sql.stripLeading().toLowerCase(Locale.ROOT);
            if (statement.startsWith("select") || statement.startsWith("with")) {
                counts.selects++;
            } else if (statement.startsWith("insert")) {
                counts.inserts++;
            } else {
                counts.other++;
            }
        }
        return sql;
    }
}
