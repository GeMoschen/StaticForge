package com.acme.staticforge.user;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

/** Password hashing (spec §8.2: BCrypt, cost 12). */
@Component
public class PasswordService {

    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(12);

    public String hash(String rawPassword) {
        return encoder.encode(rawPassword);
    }

    public boolean matches(String rawPassword, String encodedHash) {
        if (encodedHash == null || encodedHash.isBlank()) {
            return false;
        }
        return encoder.matches(rawPassword, encodedHash);
    }
}
