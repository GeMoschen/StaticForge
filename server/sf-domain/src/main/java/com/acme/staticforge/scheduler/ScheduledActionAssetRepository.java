package com.acme.staticforge.scheduler;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ScheduledActionAssetRepository extends JpaRepository<ScheduledActionAsset, ScheduledActionAsset.Key> {

    List<ScheduledActionAsset> findByActionId(long actionId);

    @Modifying
    @Query("delete from ScheduledActionAsset a where a.actionId = :actionId")
    void deleteByActionId(@Param("actionId") long actionId);

    /** The actions with a status in {@code statuses} that touch one of {@code uuids}, one row per (asset, locale, action). */
    @Query("""
            select new com.acme.staticforge.scheduler.ScheduledRef(
                    a.assetUuid, a.localeKey, s.id, s.type, s.runAt, s.nextRunAt, s.ownerUserId)
            from ScheduledActionAsset a, ScheduledAction s
            where s.id = a.actionId and a.projectId = :projectId and a.assetUuid in :uuids and s.status in :statuses
            order by s.nextRunAt, s.id
            """)
    List<ScheduledRef> findTouching(
            @Param("projectId") long projectId,
            @Param("uuids") Collection<UUID> uuids,
            @Param("statuses") Collection<ActionStatus> statuses);
}
