package com.acme.staticforge.housekeeping;

/** What started a system job run (M29.1.1, epic decision 2). */
public enum JobTrigger {
    /** The job's cron slot came due and a node's tick claimed it. */
    SCHEDULE,
    /** An instance admin's <em>Run now</em> ({@code started_by} names them). */
    MANUAL,
    /** Once after the application became ready, for jobs with {@link HousekeepingJob#runOnStartup()}. */
    STARTUP
}
