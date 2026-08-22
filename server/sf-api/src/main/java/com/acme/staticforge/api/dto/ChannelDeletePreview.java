package com.acme.staticforge.api.dto;

import java.util.List;

/** Templates that would be affected by deleting a channel (spec §15.3). */
public record ChannelDeletePreview(List<ChannelTemplateRef> affectedTemplates) {

    public record ChannelTemplateRef(String uuid, String uid, String displayName) {}
}
