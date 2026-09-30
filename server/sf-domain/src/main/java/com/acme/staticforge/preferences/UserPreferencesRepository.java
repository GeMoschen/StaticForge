package com.acme.staticforge.preferences;

import org.springframework.data.jpa.repository.JpaRepository;

public interface UserPreferencesRepository extends JpaRepository<UserPreferences, Long> {

    void deleteByUserId(Long userId);
}
