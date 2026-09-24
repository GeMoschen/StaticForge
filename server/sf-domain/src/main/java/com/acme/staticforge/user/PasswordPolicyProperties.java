package com.acme.staticforge.user;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Typed binding for {@code sf.security.password.*} (M26): the configurable part of the {@link PasswordPolicy}. The
 * 72-byte ceiling is not configurable — it is BCrypt's input limit.
 */
@Component
@ConfigurationProperties(prefix = "sf.security.password")
public class PasswordPolicyProperties {

    /** Minimum number of characters (Unicode code points). */
    private int minLength = 12;

    /** When {@code true}, a password needs at least one letter and at least one digit or symbol. */
    private boolean requireMixed;

    public int getMinLength() {
        return minLength;
    }

    public void setMinLength(int minLength) {
        this.minLength = minLength;
    }

    public boolean isRequireMixed() {
        return requireMixed;
    }

    public void setRequireMixed(boolean requireMixed) {
        this.requireMixed = requireMixed;
    }
}
