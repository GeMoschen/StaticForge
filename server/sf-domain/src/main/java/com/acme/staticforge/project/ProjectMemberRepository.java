package com.acme.staticforge.project;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, ProjectMember.ProjectMemberId> {

    List<ProjectMember> findByProjectIdOrderByUserIdAsc(Long projectId);

    Optional<ProjectMember> findByProjectIdAndUserId(Long projectId, Long userId);

    List<ProjectMember> findByUserId(Long userId);

    /** {@code [userId, membershipCount]} rows for the given users; users without memberships are absent. */
    @Query("select m.userId, count(m) from ProjectMember m where m.userId in :userIds group by m.userId")
    List<Object[]> countByUserIds(@Param("userIds") Collection<Long> userIds);

    boolean existsByProjectIdAndUserId(Long projectId, Long userId);

    void deleteByProjectIdAndUserId(Long projectId, Long userId);
}
