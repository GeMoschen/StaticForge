package com.acme.staticforge.security;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, Long> {

    Optional<RefreshToken> findByToken(String token);

    List<RefreshToken> findByFamilyId(String familyId);

    List<RefreshToken> findByUserId(Long userId);

    void deleteByFamilyId(String familyId);

    void deleteByUserId(Long userId);
}
