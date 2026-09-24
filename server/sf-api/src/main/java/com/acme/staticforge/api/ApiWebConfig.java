package com.acme.staticforge.api;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** MVC interceptors of the REST API. */
@Configuration
public class ApiWebConfig implements WebMvcConfigurer {

    private final ArchivedProjectInterceptor archivedProjectInterceptor;

    public ApiWebConfig(ArchivedProjectInterceptor archivedProjectInterceptor) {
        this.archivedProjectInterceptor = archivedProjectInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(archivedProjectInterceptor).addPathPatterns("/api/v1/projects/**");
    }
}
