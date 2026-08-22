package com.acme.staticforge.asset.media;

import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for {@link Blob} rows (spec §11.2). */
public interface BlobRepository extends JpaRepository<Blob, String> {}
