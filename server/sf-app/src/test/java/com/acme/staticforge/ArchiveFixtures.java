package com.acme.staticforge;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Export archive fixtures for import tests: an archive checked into the test resources as its unpacked entries
 * (reviewable JSON rather than a binary ZIP), and in-place edits of one {@code assets/<uuid>.json} entry — the
 * "hand-edited archive" a user could produce.
 */
public final class ArchiveFixtures {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ArchiveFixtures() {}

    /** Zips the classpath directory {@code resourceDir} (e.g. {@code exportimport/protocol-6-…}) entry by entry. */
    public static byte[] zipResourceDirectory(String resourceDir) {
        URL url = ArchiveFixtures.class.getClassLoader().getResource(resourceDir);
        if (url == null) {
            throw new IllegalArgumentException("No test resource directory " + resourceDir);
        }
        try (Stream<Path> walk = Files.walk(Path.of(url.toURI()))) {
            Path root = Path.of(url.toURI());
            List<Path> files = walk.filter(Files::isRegularFile).sorted().toList();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                for (Path file : files) {
                    zip.putNextEntry(new ZipEntry(root.relativize(file).toString().replace('\\', '/')));
                    zip.write(Files.readAllBytes(file));
                    zip.closeEntry();
                }
            }
            return out.toByteArray();
        } catch (IOException | URISyntaxException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The archive with the {@code assets/<asset>.json} entry edited by {@code edit} (the parsed {@code ExportedAsset}). */
    public static byte[] editAsset(byte[] archive, UUID asset, Consumer<ObjectNode> edit) {
        String name = "assets/" + asset + ".json";
        boolean[] found = {false};
        byte[] edited = rewrite(archive, (entry, bytes) -> {
            if (!name.equals(entry)) {
                return bytes;
            }
            found[0] = true;
            ObjectNode node = (ObjectNode) MAPPER.readTree(bytes);
            edit.accept(node);
            return MAPPER.writeValueAsBytes(node);
        });
        if (!found[0]) {
            throw new IllegalArgumentException("Archive has no entry " + name);
        }
        return edited;
    }

    /** The archive without the entry {@code name}. */
    public static byte[] withoutEntry(byte[] archive, String name) {
        return rewrite(archive, (entry, bytes) -> name.equals(entry) ? null : bytes);
    }

    @FunctionalInterface
    private interface EntryRewrite {
        /** The entry's new bytes, or {@code null} to drop it. */
        byte[] apply(String entry, byte[] bytes) throws IOException;
    }

    private static byte[] rewrite(byte[] archive, EntryRewrite rewrite) {
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(archive));
                ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                ZipEntry entry;
                while ((entry = in.getNextEntry()) != null) {
                    byte[] bytes = rewrite.apply(entry.getName(), in.readAllBytes());
                    if (bytes == null) {
                        continue;
                    }
                    zip.putNextEntry(new ZipEntry(entry.getName()));
                    zip.write(bytes);
                    zip.closeEntry();
                }
            }
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
