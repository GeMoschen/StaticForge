package com.acme.staticforge.asset.transfer;

import com.acme.staticforge.asset.CopyNames;
import java.util.List;
import java.util.UUID;

/**
 * Where a duplicate goes: the parent (a folder, or a record set for a record) and the display names of the
 * parent's live children, so the copy's name can be made unique within it.
 */
public record DuplicateTarget(UUID parentUuid, List<String> siblingNames) {

    /** "&lt;name&gt; copy", numbered ("copy 2", ...) while a sibling already has the name. */
    public String copyName(String name) {
        return CopyNames.free(name, siblingNames);
    }
}
