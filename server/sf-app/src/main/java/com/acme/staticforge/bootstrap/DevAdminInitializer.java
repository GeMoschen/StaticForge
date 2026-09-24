package com.acme.staticforge.bootstrap;

import com.acme.staticforge.user.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Seeds the instance admin {@code Admin}/{@code Admin} so a fresh installation can be signed into (spec §8.2).
 *
 * <p>Runs in every profile, but only while {@code app_user} is <b>empty</b>: once any account exists — including
 * this one after a rename, or another admin after this one was deleted — nothing is seeded again. Outside the
 * {@code dev}, {@code demo} and {@code test} profiles the seeded account must change its password before it can call
 * anything else (M26). The well-known password bypasses the password policy on purpose; the forced change applies it.
 */
@Component
public class DevAdminInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DevAdminInitializer.class);

    static final String USERNAME = "Admin";
    static final String PASSWORD = "Admin";

    private static final Profiles KNOWN_PASSWORD_PROFILES = Profiles.of("dev", "demo", "test");

    private final UserService userService;
    private final Environment environment;

    public DevAdminInitializer(UserService userService, Environment environment) {
        this.userService = userService;
        this.environment = environment;
    }

    @Override
    public void run(String... args) {
        if (!userService.isEmpty()) {
            return;
        }
        boolean mustChangePassword = !environment.acceptsProfiles(KNOWN_PASSWORD_PROFILES);
        userService.createInstanceAdmin(
                USERNAME, "admin@staticforge.local", "Administrator", PASSWORD, mustChangePassword);
        log.info(
                "Seeded instance admin '{}' into the empty user table{}.",
                USERNAME,
                mustChangePassword ? "; its password must be changed at first sign-in" : "");
    }
}
