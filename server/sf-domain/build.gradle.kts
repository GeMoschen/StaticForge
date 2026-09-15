plugins {
    `java-library`
}

description = "Entities, repositories, domain services"

dependencies {
    implementation(project(":server:sf-common"))
    implementation(project(":server:sf-template"))

    // JPA annotations + JsonNode appear in the public entity APIs, so they are exported
    // (`api`) rather than `implementation` for downstream modules and tests.
    api(libs.spring.boot.starter.data.jpa)
    api(libs.jackson.databind)
    implementation(libs.spring.security.crypto)
    implementation(libs.micrometer.core)
    implementation(libs.tika.core)
    implementation(libs.metadata.extractor)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.archunit)
    testRuntimeOnly(libs.h2)
}
