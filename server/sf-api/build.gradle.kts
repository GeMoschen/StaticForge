description = "REST controllers, DTOs, security"

dependencies {
    implementation(project(":server:sf-common"))
    implementation(project(":server:sf-domain"))
    implementation(project(":server:sf-template"))
    implementation(project(":server:sf-generate"))

    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.security)
    implementation(libs.spring.boot.starter.oauth2.resource.server)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.springdoc.openapi.starter.webmvc.ui)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.spring.security.test)
}
