package com.acme.staticforge.api;

/** Pre-authorize role expressions referencing {@code ProjectRole}. */
final class ProjectRoleExpr {

    static final String VIEWER = "T(com.acme.staticforge.project.ProjectRole).VIEWER";
    static final String EDITOR = "T(com.acme.staticforge.project.ProjectRole).EDITOR";
    static final String DEVELOPER = "T(com.acme.staticforge.project.ProjectRole).DEVELOPER";
    static final String ADMIN = "T(com.acme.staticforge.project.ProjectRole).PROJECT_ADMIN";

    private ProjectRoleExpr() {}
}
