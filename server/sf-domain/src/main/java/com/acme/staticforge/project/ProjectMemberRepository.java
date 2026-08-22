package com.acme.staticforge.project;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, ProjectMember.ProjectMemberId> {

    List<ProjectMember> findByProjectIdOrderByUserIdAsc(Long projectId);

    Optional<ProjectMember> findByProjectIdAndUserId(Long projectId, Long userId);

    List<ProjectMember> findByUserId(Long userId);

    boolean existsByProjectIdAndUserId(Long projectId, Long userId);

    void deleteByProjectIdAndUserId(Long projectId, Long userId);
}
