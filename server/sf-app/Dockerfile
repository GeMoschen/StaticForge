# Builds the StaticForge backend (sf-app bootJar) in two stages:
#   1. Gradle build on the full JDK 21 image.
#   2. Slim JRE 21 runtime.
#
# Build context is the repository root (the multi-module Gradle build needs
# settings.gradle.kts, build.gradle.kts, gradle/, and every server/* module).
# See infra/docker/docker-compose.yml and the repo-root .dockerignore.

# --- Stage 1: compile & package ---
FROM gradle:8.11.1-jdk21 AS build
WORKDIR /workspace

# Node 20 is required to build the bundled Angular SPA (see processFrontendResources in
# server/sf-app/build.gradle.kts); it is not part of the gradle image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy only what the Gradle multi-module build needs (node_modules/dist are excluded via
# .dockerignore). Gradle dependencies are re-downloaded on changes to these files,
# otherwise cached by layer.
COPY gradle gradle
COPY gradlew gradlew
COPY gradlew.bat gradlew.bat
COPY settings.gradle.kts build.gradle.kts ./
COPY server server
COPY ui ui

# Build the runnable Spring Boot fat jar. --no-daemon avoids leaving a daemon running
# inside the build container. We exclude the `-plain` jar produced alongside bootJar.
RUN ./gradlew :server:sf-app:bootJar --no-daemon \
    && BOOT_JAR="$(find server/sf-app/build/libs -name '*.jar' ! -name '*-plain.jar' -print -quit)" \
    && cp "$BOOT_JAR" /workspace/app.jar

# --- Stage 2: runtime ---
FROM eclipse-temurin:21-jre

# curl is used by the Docker Compose healthcheck against /actuator/health.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend listens on 8080 (server.port in application.yml).
EXPOSE 8080

COPY --from=build /workspace/app.jar app.jar

ENTRYPOINT ["java", "-jar", "app.jar"]
