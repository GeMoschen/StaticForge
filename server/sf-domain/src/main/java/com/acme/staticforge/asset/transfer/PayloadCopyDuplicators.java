package com.acme.staticforge.asset.transfer;

import com.acme.staticforge.asset.AssetService;
import com.acme.staticforge.asset.AssetType;
import com.acme.staticforge.asset.AssetVersionView;
import com.acme.staticforge.asset.CreateAssetCommand;
import com.acme.staticforge.revision.RevisionContext;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The asset types whose copy is a deep copy of the payload: pages, navigation items ({@code PAGE_REFERENCE}),
 * global sets and record sets (the set and its stored query, not its records). Pages and record sets mirror the
 * template or dataset they reference into {@code template_asset_id}, like their own create paths.
 */
@Configuration
class PayloadCopyDuplicators {

    @Bean
    AssetDuplicator pageDuplicator(AssetService assets) {
        return new PayloadCopy(assets, AssetType.PAGE, payload -> refOf(payload, "templateRef"));
    }

    @Bean
    AssetDuplicator navigationItemDuplicator(AssetService assets) {
        return new PayloadCopy(assets, AssetType.PAGE_REFERENCE, payload -> null);
    }

    @Bean
    AssetDuplicator globalSetDuplicator(AssetService assets) {
        return new PayloadCopy(assets, AssetType.GLOBAL_SET, payload -> null);
    }

    @Bean
    AssetDuplicator recordSetDuplicator(AssetService assets) {
        return new PayloadCopy(assets, AssetType.RECORD_SET, payload -> refOf(payload, "datasetRef"));
    }

    private static UUID refOf(JsonNode payload, String field) {
        JsonNode ref = payload.get(field);
        return ref == null || !ref.isTextual() ? null : UUID.fromString(ref.asText());
    }

    private record PayloadCopy(AssetService assets, AssetType type, Function<JsonNode, UUID> templateOf)
            implements AssetDuplicator {

        @Override
        public AssetVersionView duplicate(AssetVersionView source, DuplicateTarget target, RevisionContext ctx) {
            JsonNode payload = source.payload().deepCopy();
            return assets.create(
                    new CreateAssetCommand(
                            ctx.projectId(),
                            type,
                            target.copyName(source.displayName()),
                            target.parentUuid(),
                            payload,
                            templateOf.apply(payload)),
                    ctx);
        }
    }
}
