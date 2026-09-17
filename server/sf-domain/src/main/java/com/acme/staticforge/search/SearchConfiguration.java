package com.acme.staticforge.search;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/** Binds {@code sf.search.*} (M23.1.1). */
@Configuration
@EnableConfigurationProperties(SearchProperties.class)
public class SearchConfiguration {}
