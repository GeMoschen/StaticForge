package com.acme.staticforge.generate.pipeline;

import java.util.Arrays;

/**
 * A single file emitted by the generation pipeline (spec §18.2 WRITE). The {@code path} is a
 * relative, normalized, forward-slash path with no leading slash and no {@code ..} segments;
 * it is asserted to stay under the target root (§26.3).
 */
public record OutputFile(String path, byte[] bytes) {

    public OutputFile {
        path = normalize(path);
        bytes = bytes == null ? new byte[0] : bytes;
    }

    /** Normalizes a relative output path: forward slashes, no leading slash, {@code ..} rejected. */
    public static String normalize(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("Output path must not be null.");
        }
        String p = raw.replace('\\', '/');
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        if (p.isEmpty()) {
            throw new IllegalArgumentException("Output path must not be empty.");
        }
        for (String segment : p.split("/")) {
            if (segment.equals("..") || segment.equals(".")) {
                throw new IllegalArgumentException("Output path may not contain '..' or '.': " + raw);
            }
        }
        return p;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof OutputFile that)) {
            return false;
        }
        return path.equals(that.path) && Arrays.equals(bytes, that.bytes);
    }

    @Override
    public int hashCode() {
        return 31 * path.hashCode() + Arrays.hashCode(bytes);
    }
}
