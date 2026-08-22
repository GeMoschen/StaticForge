package com.acme.staticforge;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * StaticForge server entry point. Component/entity/repository scanning uses the
 * {@code com.acme.staticforge} root package so that all modules on the classpath are
 * discovered automatically.
 */
@SpringBootApplication
public class StaticForgeApplication {

    public static void main(String[] args) {
        SpringApplication.run(StaticForgeApplication.class, args);
    }
}
