package com.acme.staticforge.user;

import com.acme.staticforge.common.ProblemFactory;
import com.acme.staticforge.common.SfException;
import java.time.Instant;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** User account management (spec §8.2). */
@Service
public class UserService {

    private final AppUserRepository users;
    private final PasswordService passwords;

    public UserService(AppUserRepository users, PasswordService passwords) {
        this.users = users;
        this.passwords = passwords;
    }

    @Transactional(readOnly = true)
    public Optional<AppUser> findByUsername(String username) {
        return users.findByUsername(username);
    }

    @Transactional(readOnly = true)
    public Optional<AppUser> findByEmail(String email) {
        return users.findByEmail(email);
    }

    @Transactional(readOnly = true)
    public Optional<AppUser> findById(Long id) {
        return users.findById(id);
    }

    @Transactional(readOnly = true)
    public AppUser requireById(Long id) {
        return users.findById(id)
                .orElseThrow(() -> new SfException(ProblemFactory.notFound("User not found.")));
    }

    @Transactional
    public AppUser create(String username, String email, String displayName, String rawPassword) {
        if (users.findByUsername(username).isPresent()) {
            throw new SfException(ProblemFactory.conflict("Username already taken."));
        }
        if (users.findByEmail(email).isPresent()) {
            throw new SfException(ProblemFactory.conflict("Email already in use."));
        }
        AppUser user = new AppUser(username, email, Instant.now());
        user.setDisplayName(displayName);
        user.setPasswordHash(passwords.hash(rawPassword));
        return users.save(user);
    }

    /** Creates an instance admin (spec §8.2) in the same revision-agnostic transaction. */
    @Transactional
    public AppUser createInstanceAdmin(String username, String email, String displayName, String rawPassword) {
        AppUser user = create(username, email, displayName, rawPassword);
        user.setSystemRole(SystemRole.INSTANCE_ADMIN);
        return user;
    }

    @Transactional
    public void changePassword(Long userId, String newRawPassword) {
        AppUser user = requireById(userId);
        user.setPasswordHash(passwords.hash(newRawPassword));
        users.save(user);
    }

    @Transactional
    public void bumpTokenEpoch(Long userId) {
        AppUser user = requireById(userId);
        user.setTokenEpoch(user.getTokenEpoch() + 1);
        users.save(user);
    }
}
