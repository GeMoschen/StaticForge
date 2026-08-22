package com.acme.staticforge.config;

import java.io.IOException;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

/**
 * Serves the bundled Angular SPA from the bootJar at {@code /ui/}.
 *
 * <p>The bundle is staged under {@code static/ui/} (see {@code processFrontendResources}
 * in {@code server/sf-app/build.gradle.kts}). Real assets are served as files; any other
 * path under {@code /ui/**} is a client-side route and falls back to {@code index.html} so
 * that deep links and refreshes resolve in the Angular router.
 */
@Configuration
public class UiStaticConfig implements WebMvcConfigurer {

    private static final String INDEX_HTML = "/static/ui/index.html";

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/ui", "/ui/**")
                .addResourceLocations("classpath:/static/ui/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected Resource getResource(String resourcePath, Resource location)
                            throws IOException {
                        if (resourcePath == null || resourcePath.isEmpty() || resourcePath.equals("index.html")) {
                            return new ClassPathResource(INDEX_HTML);
                        }
                        Resource requested = location.createRelative(resourcePath);
                        return (requested.exists() && requested.isReadable())
                                ? requested
                                : new ClassPathResource(INDEX_HTML);
                    }
                });
    }
}
