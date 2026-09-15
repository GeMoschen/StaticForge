package com.acme.staticforge.asset.content;

import com.acme.staticforge.asset.ReferenceKind;
import java.util.UUID;

/**
 * One outgoing reference found in a payload, before its target UUID is resolved to an asset
 * (spec §5.4). {@code sourcePath} addresses the value inside the payload, for example
 * {@code content.heroImage} or {@code bodies.main[0].templateRef}.
 */
public record ExtractedReference(ReferenceKind kind, UUID target, String sourcePath) {}
