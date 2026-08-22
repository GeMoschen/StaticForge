package com.acme.staticforge.common;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * RFC 9457 {@code application/problem+json} document.
 *
 * <p>Core members are {@code type}, {@code title}, {@code status}, {@code detail},
 * {@code instance}. Additional members (e.g. {@code code}, {@code expectedRevision}) are
 * carried in {@link #extensions} and serialized as peers of the standard members.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public final class Problem {

    private final String type;
    private final String title;
    private final Integer status;
    private final String detail;
    private final String instance;
    private final Map<String, Object> extensions;

    private Problem(String type, String title, Integer status, String detail, String instance,
            Map<String, Object> extensions) {
        this.type = type;
        this.title = title;
        this.status = status;
        this.detail = detail;
        this.instance = instance;
        this.extensions = new LinkedHashMap<>(extensions);
    }

    public static Builder builder() {
        return new Builder();
    }

    public String getType() {
        return type;
    }

    public String getTitle() {
        return title;
    }

    public Integer getStatus() {
        return status;
    }

    public String getDetail() {
        return detail;
    }

    public String getInstance() {
        return instance;
    }

    @JsonAnyGetter
    public Map<String, Object> getExtensions() {
        return extensions;
    }

    public static final class Builder {
        private String type;
        private String title;
        private Integer status;
        private String detail;
        private String instance;
        private final Map<String, Object> extensions = new LinkedHashMap<>();

        private Builder() {}

        public Builder type(String type) {
            this.type = type;
            return this;
        }

        public Builder title(String title) {
            this.title = title;
            return this;
        }

        public Builder status(int status) {
            this.status = status;
            return this;
        }

        public Builder detail(String detail) {
            this.detail = detail;
            return this;
        }

        public Builder instance(String instance) {
            this.instance = instance;
            return this;
        }

        public Builder property(String key, Object value) {
            this.extensions.put(key, value);
            return this;
        }

        public Problem build() {
            return new Problem(type, title, status, detail, instance, extensions);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Problem problem)) return false;
        return Objects.equals(type, problem.type)
                && Objects.equals(title, problem.title)
                && Objects.equals(status, problem.status)
                && Objects.equals(detail, problem.detail)
                && Objects.equals(instance, problem.instance)
                && Objects.equals(extensions, problem.extensions);
    }

    @Override
    public int hashCode() {
        return Objects.hash(type, title, status, detail, instance, extensions);
    }
}
