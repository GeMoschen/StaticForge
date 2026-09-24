package com.acme.staticforge.project;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, Long> {

    Optional<Project> findByKey(String key);

    boolean existsByKey(String key);

    /** The {@code archived} flag alone, without loading the project (checked on every revision allocation). */
    @Query("select p.archived from Project p where p.id = :id")
    Optional<Boolean> findArchivedById(@Param("id") Long id);
}
