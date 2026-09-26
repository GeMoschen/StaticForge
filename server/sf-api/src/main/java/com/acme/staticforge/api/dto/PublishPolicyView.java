package com.acme.staticforge.api.dto;

import java.util.List;

/**
 * A project's publish policy (M28, spec §8.3): the publish permissions its editors hold, in declaration order —
 * {@code RELEASE}, {@code SCHEDULE_RELEASE}, {@code INCREMENTAL_BUILD}, {@code FULL_BUILD}. Request and response body
 * of {@code /projects/{key}/publish-policy}.
 */
public record PublishPolicyView(List<String> editor) {}
