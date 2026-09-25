package com.acme.staticforge.scheduler;

import java.lang.management.ManagementFactory;
import java.net.InetAddress;
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

    /** This node's name in {@code lease_owner}; defaults to {@code hostname:pid}. Must differ between nodes. */
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

    /** {@link #getNodeId()}, or {@code hostname:pid} when unset. */
    public String effectiveNodeId() {
        if (nodeId != null && !nodeId.isBlank()) {
            return nodeId.trim();
        }
        String host;
        try {
            host = InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            host = "node";
        }
        return host + ":" + ManagementFactory.getRuntimeMXBean().getPid();
    }
}
