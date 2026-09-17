import org.apache.tools.ant.taskdefs.condition.Os
import org.springframework.boot.gradle.tasks.run.BootRun

plugins {
    alias(libs.plugins.spring.boot)
}

description = "Spring Boot application, Liquibase schema, configuration"

dependencies {
    implementation(project(":server:sf-common"))
    implementation(project(":server:sf-domain"))
    implementation(project(":server:sf-template"))
    implementation(project(":server:sf-generate"))
    implementation(project(":server:sf-api"))

    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.actuator)
    runtimeOnly(libs.micrometer.registry.prometheus)
    implementation(libs.liquibase.core)

    runtimeOnly(libs.postgresql)
    runtimeOnly(libs.h2)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.spring.security.test)
    testImplementation(libs.jqwik)
    // Search recovery tests forge Lucene commits (outdated schema, foreign owner); production code reaches Lucene only
    // through sf-domain.
    testImplementation(libs.lucene.core)
}

tasks.named<Jar>("bootJar") {
    archiveBaseName.set("staticforge-server")
}

// Runs the application with the `demo` profile: in-memory H2 with the demo Liquibase context
// and the demo JWT secret (see application-demo.yml). Mirrors `bootRun`, only the profile differs.
tasks.register<BootRun>("bootRunDemo") {
    group = "application"
    description = "Runs the Spring Boot application with the 'demo' profile."
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("com.acme.staticforge.StaticForgeApplication")
    args("--spring.profiles.active=demo")
}

// ----------------------------------------------------------------------
// Frontend bundling. Builds the Angular SPA in `ui/` and stages it under
// `static/ui/` so it ships inside the bootJar and is served at `/ui/`.
//
// Skips the npm build entirely with `-Pfrontend.skip=true` (e.g. a CI job that
// already built and tested the frontend separately). The npm command is
// resolved per-OS; the base href defaults to `/ui/` (see `-Pfrontend.baseHref`).
// ----------------------------------------------------------------------
val frontendSkip = providers.gradleProperty("frontend.skip").map(String::toBoolean).getOrElse(false)
val frontendBaseHref = providers.gradleProperty("frontend.baseHref").getOrElse("/ui/")
val uiDir = rootProject.file("ui")
val gradleBuildDir = layout.buildDirectory.get().getAsFile()
val frontendOut = File(gradleBuildDir, "frontend")
val npmCommand = if (Os.isFamily(Os.FAMILY_WINDOWS)) "npm.cmd" else "npm"

val frontendNpmCi = tasks.register<Exec>("frontendNpmCi") {
    group = "build"
    description = "Installs ui/ dependencies (npm ci) when node_modules is absent."
    onlyIf { !frontendSkip && !File(uiDir, "node_modules").exists() }
    workingDir = uiDir
    inputs.file(File(uiDir, "package.json"))
    inputs.file(File(uiDir, "package-lock.json"))
    commandLine(npmCommand, "ci")
}

val buildFrontend = tasks.register<Exec>("buildFrontend") {
    group = "build"
    description = "Builds the Angular SPA into a production bundle staged for the bootJar."
    onlyIf { !frontendSkip }
    dependsOn(frontendNpmCi)
    workingDir = uiDir
    inputs.files(
        File(uiDir, "src"),
        File(uiDir, "angular.json"),
        File(uiDir, "package.json"),
        File(uiDir, "package-lock.json"),
        File(uiDir, "tsconfig.json"),
        File(uiDir, "tsconfig.app.json"),
    )
    outputs.dir(frontendOut)
    commandLine(
        npmCommand, "run", "build", "--",
        "--base-href", frontendBaseHref,
        "--output-path", frontendOut.absolutePath,
    )
}

val processFrontendResources = tasks.register<Copy>("processFrontendResources") {
    group = "build"
    description = "Stages the SPA bundle under static/ui for inclusion in the bootJar."
    dependsOn(buildFrontend)
    from(File(frontendOut, "browser"))
    into(File(gradleBuildDir, "generated/resources/static/ui"))
}

sourceSets {
    main {
        resources.srcDir(File(gradleBuildDir, "generated/resources"))
    }
}

tasks.named("processResources") {
    dependsOn(processFrontendResources)
}

tasks.register<JavaExec>("generateOpenApi") {
    group = "documentation"
    description = "Boots the app and exports the springdoc OpenAPI document to build/openapi/openapi.json"
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("com.acme.staticforge.tooling.OpenApiGeneratorMain")
    systemProperty("openapi.output", layout.buildDirectory.file("openapi/openapi.json").get().asFile.absolutePath)
    args(
        "--server.port=0",
        "--spring.datasource.url=jdbc:h2:mem:openapi;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "--spring.datasource.driver-class-name=org.h2.Driver",
        "--spring.datasource.username=sa",
        "--spring.datasource.password=",
        "--sf.security.jwt.secret=generate-openapi-dev-secret-0123456789"
    )
}
