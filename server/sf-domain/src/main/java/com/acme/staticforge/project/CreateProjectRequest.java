package com.acme.staticforge.project;

/** Domain command for creating a project (spec §8.1). */
public record CreateProjectRequest(String key, String name, String description, String comment) {}
