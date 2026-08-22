plugins {
    `java-library`
}

description = "CDL and OCTL parsing, validation and rendering"

dependencies {
    implementation(project(":server:sf-common"))
    api(libs.jackson.databind)

    testImplementation(libs.spring.boot.starter.test)
}
