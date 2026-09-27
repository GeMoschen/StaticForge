package com.acme.staticforge.asset.media;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Data access for {@link Blob} rows (spec §11.2). */
public interface BlobRepository extends JpaRepository<Blob, String> {

    /**
     * The row of {@code sha256}, locked ({@code SELECT … FOR UPDATE}) until the caller's transaction ends. Every writer
     * that reuses an existing blob ({@link BlobWriter}) and the blob sweep's per-hash delete take this lock, so a sweep
     * never deletes a blob a concurrent upload is about to reference (M29.2.3).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from Blob b where b.sha256 = :sha")
    Optional<Blob> findForUpdate(@Param("sha") String sha256);
}
