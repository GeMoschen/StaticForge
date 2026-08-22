pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "staticforge"

include("server:sf-common")
include("server:sf-domain")
include("server:sf-template")
include("server:sf-generate")
include("server:sf-api")
include("server:sf-app")
