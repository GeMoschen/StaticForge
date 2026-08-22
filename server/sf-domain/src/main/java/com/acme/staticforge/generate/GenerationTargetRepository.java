package com.acme.staticforge.generate;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GenerationTargetRepository extends JpaRepository<GenerationTarget, Long> {

    List<GenerationTarget> findByProjectId(long projectId);

    Optional<GenerationTarget> findByProjectIdAndDefaultTargetTrue(long projectId);
}
