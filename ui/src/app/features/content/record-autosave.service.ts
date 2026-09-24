import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AutosaveService } from '../../shared/services/autosave.base';
import { ContentService, etagFor, type RecordDetailView } from './content.service';

/** What a record save sends: its values, and a display name for datasets without a title editor. */
export interface RecordPayload {
  content: Record<string, unknown>;
}

/**
 * Debounced autosave for the record editor (M19.4.2) — the same debounce, `If-Match` and conflict
 * behavior as the page editor, persisted through `PUT /records/{uuid}`. Provided at the record
 * editor component level.
 */
@Injectable()
export class RecordAutosaveService extends AutosaveService<RecordPayload, RecordDetailView> {
  private readonly content = inject(ContentService);

  protected persist(payload: RecordPayload, revision: number | undefined): Observable<RecordDetailView> {
    return this.content.updateRecord(this.projectKey, this.uuid, payload, etagFor(revision ?? 0));
  }

  protected reload(): Observable<RecordDetailView> {
    return this.content.getRecord(this.projectKey, this.uuid);
  }
}
