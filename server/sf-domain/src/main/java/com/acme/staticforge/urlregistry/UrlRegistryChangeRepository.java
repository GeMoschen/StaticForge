package com.acme.staticforge.urlregistry;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** {@link UrlRegistryChange} persistence (M32.5). */
public interface UrlRegistryChangeRepository extends JpaRepository<UrlRegistryChange, Long> {

    /** The changes of {@code area} (or of both areas) after {@code since}. */
    @Query("""
            SELECT c FROM UrlRegistryChange c
            WHERE c.projectId = :projectId AND c.changedAt > :since AND (c.area IS NULL OR c.area = :area)
            """)
    List<UrlRegistryChange> findSince(
            @Param("projectId") long projectId, @Param("area") UrlArea area, @Param("since") Instant since);

    /** Housekeeping: changes older than every build that could still be a base build. */
    @Modifying
    @Query("DELETE FROM UrlRegistryChange c WHERE c.projectId = :projectId AND c.changedAt < :before")
    int deleteOlderThan(@Param("projectId") long projectId, @Param("before") Instant before);
}
