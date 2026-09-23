description = "Build planner, generation targets, writers"

dependencies {
    implementation(project(":server:sf-common"))
    implementation(project(":server:sf-domain"))
    implementation(project(":server:sf-template"))

    // SseEmitter for progress streaming (§18.5, §20.2).
    implementation(libs.spring.boot.starter.web)

    // Micrometer metrics (§26.4).
    implementation(libs.micrometer.core)

    testImplementation(libs.spring.boot.starter.test)
    // Architecture guard over the modules generation sees: one record set query evaluator (M25.1.2).
    testImplementation(libs.archunit)
}
