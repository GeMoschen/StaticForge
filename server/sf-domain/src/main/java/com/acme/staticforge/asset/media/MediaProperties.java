package com.acme.staticforge.asset.media;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;

/**
 * Typed binding for {@code sf.media.*} (spec §11.4, §11.5). The allow-list, size cap, EXIF
 * strip flag and declarative variant policy are all configurable; defaults match the spec.
 */
@Component
@ConfigurationProperties(prefix = "sf.media")
public class MediaProperties {

    /** Backend selector: {@code filesystem} (default) or {@code s3}. */
    private String store = "filesystem";

    /** Filesystem blob-store root directory. */
    private String root = "./build/media";

    /** Maximum accepted upload size; requests above this are rejected with a 413. */
    private DataSize maxUploadSize = DataSize.ofMegabytes(100);

    /** Whether to strip EXIF metadata (including GPS) from uploaded images. */
    private boolean stripExif = true;

    /** MIME allow-list; {@code image/*} style family wildcards are supported. */
    private List<String> allowedMime = new ArrayList<>(List.of(
            "image/*", "video/mp4", "application/pdf", "text/css", "application/javascript", "font/*"));

    /** Maximum image dimension (width or height) in pixels. */
    private int maxImageDimension = 12_000;

    /** Declarative variant policy (spec §11.4). */
    private List<VariantDefinition> variants = new ArrayList<>(List.of(
            new VariantDefinition("w400", 400, "jpeg", 82),
            new VariantDefinition("w1600", 1600, "jpeg", 78)));

    public String getStore() {
        return store;
    }

    public void setStore(String store) {
        this.store = store;
    }

    public String getRoot() {
        return root;
    }

    public void setRoot(String root) {
        this.root = root;
    }

    public DataSize getMaxUploadSize() {
        return maxUploadSize;
    }

    public void setMaxUploadSize(DataSize maxUploadSize) {
        this.maxUploadSize = maxUploadSize;
    }

    public boolean isStripExif() {
        return stripExif;
    }

    public void setStripExif(boolean stripExif) {
        this.stripExif = stripExif;
    }

    public List<String> getAllowedMime() {
        return allowedMime;
    }

    public void setAllowedMime(List<String> allowedMime) {
        this.allowedMime = allowedMime;
    }

    public int getMaxImageDimension() {
        return maxImageDimension;
    }

    public void setMaxImageDimension(int maxImageDimension) {
        this.maxImageDimension = maxImageDimension;
    }

    public List<VariantDefinition> getVariants() {
        return variants;
    }

    public void setVariants(List<VariantDefinition> variants) {
        this.variants = variants;
    }

    /** A single variant declaration: target width, output format and quality. */
    public record VariantDefinition(String name, Integer width, String format, Integer quality) {}
}
