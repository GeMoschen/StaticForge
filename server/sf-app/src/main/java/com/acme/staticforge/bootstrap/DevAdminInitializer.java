package com.acme.staticforge.bootstrap;

import com.acme.staticforge.user.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/**
 * Seeds a default instance admin on dev/demo startup so a fresh database is immediately
 * usable (spec §8.2). Runs only on the local {@code dev} and {@code demo} profiles, never
 * in {@code prod} or {@code test}.
 */
@Component
//@Profile({"dev", "demo"})
public class DevAdminInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DevAdminInitializer.class);

    private static final String USERNAME = "Admin";
    private static final String PASSWORD = "Admin";

    private final UserService userService;

    public DevAdminInitializer(UserService userService) {
        this.userService = userService;
    }

    @Override
    public void run(String... args) {
        if (userService.findByUsername(USERNAME).isPresent()) {
            return;
        }
        userService.createInstanceAdmin(USERNAME, "admin@staticforge.local", "Administrator", PASSWORD);
        log.info("Seeded dev admin user '{}'.", USERNAME);
    }
}
