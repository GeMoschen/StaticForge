package com.acme.staticforge.scheduler;

import com.acme.staticforge.node.NodeIdentity;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/** Typed binding for {@code sf.scheduler.*} (M27.4.1, epic decision 20). */
@Component
@ConfigurationProperties(prefix = "sf.scheduler")
public class SchedulerProperties {

    /**
     * Whether this node polls for due actions. Off in the {@code test} profile (tests drive {@code tick()}); an
     * operator can switch it off on nodes that shouldn't execute schedules — any node that polls is enough.
     */
    private boolean enabled = true;

    /** How often the node looks for due actions; an action runs at most this late on an idle cluster. */
    private Duration pollInterval = Duration.ofSeconds(15);

    /** How many due actions one poll claims at most. */
    private int batchSize = 20;

    /**
     * How long a claim is valid. The executing node extends it while it runs; when a node dies, another re-claims
     * the action once the lease expired, so this is also the fail-over delay.
     */
    private Duration lease = Duration.ofMinutes(2);

    /**
     * This node's name in {@code lease_owner}; defaults to {@code sf.node-id} ({@code <hostname>-<pid>} unless set, see
     * {@link NodeIdentity}). Must differ between nodes; only set it to override the shared node id.
     */
    private String nodeId;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public Duration getPollInterval() {
        return pollInterval;
    }

    public void setPollInterval(Duration pollInterval) {
        this.pollInterval = pollInterval;
    }

    public int getBatchSize() {
        return batchSize;
    }

    public void setBatchSize(int batchSize) {
        this.batchSize = batchSize;
    }

    public Duration getLease() {
        return lease;
    }

    public void setLease(Duration lease) {
        this.lease = lease;
    }

    public String getNodeId() {
        return nodeId;
    }

    public void setNodeId(String nodeId) {
        this.nodeId = nodeId;
    }

    /** {@link #getNodeId()} when set (an override for the scheduler and the system-job runner), else {@code node}'s id ({@code sf.node-id}). */
    public String effectiveNodeId(NodeIdentity node) {
        if (nodeId != null && !nodeId.isBlank()) {
            return nodeId.trim();
        }
        return node.id();
    }
}
