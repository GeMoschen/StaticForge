package com.acme.staticforge.node;

import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * This node's name ({@code sf.node-id}, M29.2.1, epic decision 9): what generation runs record as their
 * {@code executor_node}, and — unless {@code sf.scheduler.node-id} overrides it — the {@code lease_owner} of the
 * scheduler and the system-job runner, so all three agree on who "this node" is.
 *
 * <p>Defaults to {@code <hostname>-<pid>}, which changes with every restart. A stable name per node
 * ({@code sf.node-id: cms-1}) lets the node recognize its own interrupted runs right after a restart; with the default,
 * {@link #isDeadLocalProcess} still recognizes runs of an earlier process on the same host, and any other run is
 * recovered once its heartbeat is stale. Names must differ between nodes. Logged once at startup.
 */
@Component
public class NodeIdentity {

    private static final Logger log = LoggerFactory.getLogger(NodeIdentity.class);

    private final String id;
    private final String hostname;
    private final long pid;

    public NodeIdentity(@Value("${sf.node-id:}") String configured) {
        this.hostname = localHostname();
        this.pid = ManagementFactory.getRuntimeMXBean().getPid();
        this.id = configured == null || configured.isBlank() ? hostname + "-" + pid : configured.trim();
        log.info("Node id: {}", id);
    }

    /** A fixed identity (tests, tools). */
    public static NodeIdentity of(String id) {
        return new NodeIdentity(id);
    }

    /** This node's name. */
    public String id() {
        return id;
    }

    /**
     * Whether {@code nodeId} is the default name ({@code <hostname>-<pid>}) of <em>another</em> process on this host
     * that is no longer running — a run it recorded can't be executing anywhere. {@code false} for any other name,
     * this process, or a pid that is alive (possibly reused: then the heartbeat decides).
     */
    public boolean isDeadLocalProcess(String nodeId) {
        if (nodeId == null || !nodeId.startsWith(hostname + "-")) {
            return false;
        }
        String suffix = nodeId.substring(hostname.length() + 1);
        if (suffix.isEmpty() || suffix.length() > 18 || !suffix.chars().allMatch(Character::isDigit)) {
            return false;
        }
        long other = Long.parseLong(suffix);
        return other != pid && ProcessHandle.of(other).map(p -> !p.isAlive()).orElse(true);
    }

    @Override
    public String toString() {
        return id;
    }

    private static String localHostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "node";
        }
    }
}
