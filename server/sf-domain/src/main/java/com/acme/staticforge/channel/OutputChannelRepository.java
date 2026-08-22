package com.acme.staticforge.channel;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OutputChannelRepository extends JpaRepository<OutputChannel, Long> {

    List<OutputChannel> findByProjectIdOrderByPositionAsc(long projectId);

    Optional<OutputChannel> findByProjectIdAndKey(long projectId, String key);

    Optional<OutputChannel> findByProjectIdAndDefaultChannelTrue(long projectId);

    boolean existsByProjectIdAndKey(long projectId, String key);
}
