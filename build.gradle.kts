import com.diffplug.gradle.spotless.SpotlessExtension
import io.spring.gradle.dependencymanagement.dsl.DependencyManagementExtension
import org.gradle.api.artifacts.ProjectDependency
import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.tasks.compile.JavaCompile
import org.gradle.api.tasks.testing.Test
import org.gradle.api.tasks.testing.logging.TestLogEvent
import org.gradle.jvm.toolchain.JavaLanguageVersion
import org.gradle.testing.jacoco.plugins.JacocoPluginExtension
import org.gradle.testing.jacoco.tasks.JacocoCoverageVerification
import org.gradle.testing.jacoco.tasks.JacocoReport
import org.springframework.boot.gradle.plugin.SpringBootPlugin

plugins {
    alias(libs.plugins.spring.boot) apply false
    alias(libs.plugins.dependency.management) apply false
    alias(libs.plugins.spotless) apply false
}

// The root project itself has no Java sources; `base` provides the `check`/`assemble`
// lifecycle tasks that `checkModuleLayers` attaches to.
apply(plugin = "base")
apply(plugin = "jacoco")

allprojects {
    group = "com.acme.staticforge"
    version = "0.1.0-SNAPSHOT"
    description = "StaticForge CMS"
}

// Resolved once at the root scope; the `libs` catalog accessor is not visible inside
// the nested `subprojects`/closure receivers below.
val javaVersion = libs.versions.java.get().toInt()

// Allowed module dependency edges (spec §4.3 / tasks/project-structure.md). The graph is
// strictly upward: sf-app -> sf-api -> { sf-domain, sf-template, sf-generate } -> sf-common.
// Any reverse or peer edge is a build failure.
val allowedEdges: Map<String, Set<String>> = mapOf(
    "sf-common" to emptySet(),
    "sf-domain" to setOf("sf-common", "sf-template"),
    "sf-template" to setOf("sf-common"),
    "sf-generate" to setOf("sf-common", "sf-domain", "sf-template"),
    "sf-api" to setOf("sf-common", "sf-domain", "sf-template", "sf-generate"),
    "sf-app" to setOf("sf-common", "sf-domain", "sf-template", "sf-generate", "sf-api")
)

subprojects {
    apply(plugin = "java")
    apply(plugin = "jacoco")
    apply(plugin = "io.spring.dependency-management")
    apply(plugin = "com.diffplug.spotless")

    extensions.configure<JavaPluginExtension> {
        toolchain {
            languageVersion.set(JavaLanguageVersion.of(javaVersion))
        }
    }

    extensions.configure<DependencyManagementExtension> {
        imports {
            mavenBom(SpringBootPlugin.BOM_COORDINATES)
        }
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
        options.compilerArgs.add("-parameters")
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        testLogging {
            events(TestLogEvent.FAILED, TestLogEvent.SKIPPED)
            showStandardStreams = false
        }
    }

    extensions.configure<JacocoPluginExtension> {
        toolVersion = "0.8.12"
    }

    tasks.withType<JacocoReport>().configureEach {
        reports {
            xml.required.set(true)
            html.required.set(true)
        }
    }

    extensions.configure<SpotlessExtension> {
        java {
            removeUnusedImports()
            trimTrailingWhitespace()
            endWithNewline()
        }
    }
}

// Verifies the module dependency graph matches §4.3; fails the build on any forbidden edge.
tasks.register("checkModuleLayers") {
    group = "verification"
    description = "Fails the build if a module depends on a forbidden (lower/peer) module."
    val errors = mutableListOf<String>()
    doLast {
        subprojects.forEach { p ->
            val moduleName = p.name
            if (!allowedEdges.containsKey(moduleName)) return@forEach
            p.configurations.filter { it.name == "compileClasspath" }.forEach { cfg ->
                cfg.dependencies.withType(ProjectDependency::class.java).forEach { dep ->
                    val depName = dep.path.substringAfterLast(':')
                    if (!allowedEdges.getValue(moduleName).contains(depName)) {
                        errors.add("$moduleName -> $depName (not allowed by §4.3)")
                    }
                }
            }
        }
        if (errors.isNotEmpty()) {
            throw GradleException("Forbidden module dependencies:\n - ${errors.joinToString("\n - ")}")
        }
    }
}

tasks.named("check") {
    dependsOn("checkModuleLayers")
}

// ----------------------------------------------------------------------
// Jacoco coverage gate (spec §25.7). Aggregates all backend modules into a single
// report and enforces line ≥ 80%, branch ≥ 70%, and line ≥ 90% for the `render` and
// `revision` packages.
//
// NOTE: the gate is intentionally NOT wired into `check` yet — it is registered as a
// standalone `jacocoCoverageGate` task so the CI/quality-gates agent (M7.5) can measure
// current coverage and decide whether to promote it to the `check` lifecycle without
// breaking `./gradlew build` before the suite reaches the thresholds.
// ----------------------------------------------------------------------
val coverageModules = listOf("sf-common", "sf-domain", "sf-template", "sf-generate", "sf-api", "sf-app")
    .map { project(":server:$it") }

val coverageSourceDirs = files(coverageModules.map { it.layout.projectDirectory.dir("src/main/java") })
val coverageClassDirs = files(coverageModules.map { it.layout.buildDirectory.dir("classes/java/main") })
val coverageExecFiles = files(coverageModules.map { it.layout.buildDirectory.file("jacoco/test.exec") })

tasks.register<JacocoReport>("jacocoAggregateReport") {
    group = "verification"
    description = "Aggregates Jacoco coverage across all backend modules (§25.7)."
    dependsOn(coverageModules.map { it.tasks.named("test") })
    sourceDirectories.setFrom(coverageSourceDirs)
    classDirectories.setFrom(coverageClassDirs)
    executionData.setFrom(coverageExecFiles)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}

tasks.register<JacocoCoverageVerification>("jacocoCoverageGate") {
    group = "verification"
    description = "Enforces §25.7 coverage thresholds (NOT wired into `check` yet)."
    dependsOn("jacocoAggregateReport")
    sourceDirectories.setFrom(coverageSourceDirs)
    classDirectories.setFrom(coverageClassDirs)
    executionData.setFrom(coverageExecFiles)
    violationRules {
        rule {
            limit {
                counter = "LINE"
                value = "COVEREDRATIO"
                minimum = "0.80".toBigDecimal()
            }
        }
        rule {
            limit {
                counter = "BRANCH"
                value = "COVEREDRATIO"
                minimum = "0.70".toBigDecimal()
            }
        }
        rule {
            element = "PACKAGE"
            includes = listOf(
                "com.acme.staticforge.template.render",
                "com.acme.staticforge.generate.render")
            limit {
                counter = "LINE"
                value = "COVEREDRATIO"
                minimum = "0.90".toBigDecimal()
            }
        }
        rule {
            element = "PACKAGE"
            includes = listOf("com.acme.staticforge.revision")
            limit {
                counter = "LINE"
                value = "COVEREDRATIO"
                minimum = "0.90".toBigDecimal()
            }
        }
    }
}
