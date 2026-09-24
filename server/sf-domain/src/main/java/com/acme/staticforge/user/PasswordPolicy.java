package com.acme.staticforge.user;

import com.acme.staticforge.common.Problem;
import com.acme.staticforge.common.SfException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Rules a new password must meet (M26, spec §26): a configurable minimum length, optionally a mix of letters and
 * digits/symbols, and always at most {@value #MAX_BYTES} UTF-8 bytes — BCrypt silently ignores everything past that,
 * so a longer password is rejected instead of truncated. Applies wherever a password is <em>set</em> (self change,
 * admin create, admin reset), never to login: existing passwords keep working.
 */
@Component
public class PasswordPolicy {

    /** BCrypt's input limit. */
    public static final int MAX_BYTES = 72;

    /** Length of a generated password unless the policy asks for more. */
    static final int GENERATED_LENGTH = 16;

    // Unambiguous characters only (no 0/O, 1/l/I), since an admin may have to read a generated password out.
    private static final String LETTERS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
    private static final String DIGITS_AND_SYMBOLS = "23456789-_.!?#%+=";
    private static final String ALPHABET = LETTERS + DIGITS_AND_SYMBOLS;

    private final PasswordPolicyProperties properties;
    private final SecureRandom random = new SecureRandom();

    public PasswordPolicy(PasswordPolicyProperties properties) {
        this.properties = properties;
    }

    /** The effective minimum length; never below 1, so an empty password is always refused. */
    public int minLength() {
        return Math.max(1, properties.getMinLength());
    }

    public boolean requireMixed() {
        return properties.isRequireMixed();
    }

    /** Every rule {@code raw} breaks, one message each, in a stable order; empty when the password is acceptable. */
    public List<String> validate(String raw) {
        String password = raw == null ? "" : raw;
        List<String> errors = new ArrayList<>();
        int length = password.codePointCount(0, password.length());
        if (length < minLength()) {
            errors.add("Password must be at least " + minLength() + " characters long.");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            errors.add("Password must be at most " + MAX_BYTES + " bytes long (UTF-8); characters outside ASCII take"
                    + " two to four bytes each.");
        }
        if (requireMixed()) {
            if (password.codePoints().noneMatch(Character::isLetter)) {
                errors.add("Password must contain at least one letter.");
            }
            if (password.codePoints().noneMatch(cp -> !Character.isLetter(cp) && !Character.isWhitespace(cp))) {
                errors.add("Password must contain at least one digit or symbol.");
            }
        }
        return errors;
    }

    /** Throws {@code 400 SF-API-0400} listing every broken rule under {@code errors} when {@code raw} is refused. */
    public void requireValid(String raw) {
        List<String> errors = validate(raw);
        if (!errors.isEmpty()) {
            throw new SfException(Problem.builder()
                    .type("https://cms.example.com/problems/sf-api-0400")
                    .title("Bad Request")
                    .status(400)
                    .detail("The password does not meet the password policy.")
                    .property("code", "SF-API-0400")
                    .property("errors", List.copyOf(errors))
                    .build());
        }
    }

    /**
     * A random password from a {@link SecureRandom} that always satisfies this policy: {@value #GENERATED_LENGTH}
     * ASCII characters (more when the minimum length asks for it, never past {@value #MAX_BYTES}) with at least one
     * letter and one digit or symbol.
     */
    public String generate() {
        int length = Math.min(MAX_BYTES, Math.max(GENERATED_LENGTH, minLength()));
        char[] chars = new char[length];
        chars[0] = pick(LETTERS);
        chars[1] = pick(DIGITS_AND_SYMBOLS);
        for (int i = 2; i < length; i++) {
            chars[i] = pick(ALPHABET);
        }
        for (int i = length - 1; i > 0; i--) {
            int j = random.nextInt(i + 1);
            char swap = chars[i];
            chars[i] = chars[j];
            chars[j] = swap;
        }
        return new String(chars);
    }

    private char pick(String alphabet) {
        return alphabet.charAt(random.nextInt(alphabet.length()));
    }
}
