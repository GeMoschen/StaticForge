package com.acme.staticforge.tooling;

import com.acme.staticforge.StaticForgeApplication;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;

/**
 * Boots the application on a random port, extracts the springdoc-generated OpenAPI
 * document from {@code /v3/api-docs}, and writes it to a file. Used by the
 * {@code generateOpenApi} Gradle task so the OpenAPI document stays a build artifact
 * derived from the controllers (single source of truth, spec §4.2).
 */
public final class OpenApiGeneratorMain {

    private OpenApiGeneratorMain() {}

    public static void main(String[] args) throws Exception {
        String output = System.getProperty("openapi.output", "build/openapi/openapi.json");

        try (ConfigurableApplicationContext ctx = new SpringApplication(StaticForgeApplication.class).run(args)) {
            int port = ctx.getBean(Environment.class).getProperty("local.server.port", Integer.class);

            HttpClient client = HttpClient.newHttpClient();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("http://localhost:" + port + "/v3/api-docs"))
                    .GET()
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                throw new IllegalStateException("Expected 200 from /v3/api-docs, got " + response.statusCode());
            }

            Path path = Path.of(output).toAbsolutePath();
            Files.createDirectories(path.getParent());
            Files.writeString(path, response.body());
            System.out.println("OpenAPI document written to " + path);
        }
    }
}
