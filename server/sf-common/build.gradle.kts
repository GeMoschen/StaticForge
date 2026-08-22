plugins {
    `java-library`
}

description = "Value objects, errors, utilities — no Spring, no DB"

dependencies {
    api(libs.jackson.databind)
    api(libs.jackson.datatype.jsr310)

    testImplementation(libs.spring.boot.starter.test)
}
