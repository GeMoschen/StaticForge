/** The notices of compacted history (M29.5.2, epic decision 13), worded once for every place that shows them. */

/** Marks a revision whose own exact changes were compacted (`RevisionView.compacted`): spine and list. */
export const COMPACTED_REVISION_HINT = 'Exact changes compacted — end-of-day state kept';

/** The time-travel banner, when the travelled-to revision or a read at it is compacted. */
export const COMPACTED_TIME_TRAVEL_NOTICE = 'Compacted history: you see the state at the end of that day';

/** The restore confirmations, for a revision whose history is compacted. */
export const COMPACTED_RESTORE_NOTICE =
  "This revision's history is compacted: the state at the end of its day will be restored, not the exact state.";

/** The asset restore confirmation, for an asset whose change at the revision was compacted. */
export const COMPACTED_ASSET_RESTORE_NOTICE =
  "This asset's exact state at this revision was compacted: the state at the end of that day will be restored.";
