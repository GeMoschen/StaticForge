import { Observable } from 'rxjs';

/**
 * A single decoded Server-Sent Event frame from the generation progress
 * stream. Mirrors the `progress` event payload emitted by the backend.
 */
export interface GenerationRunEvent {
  stage: string;
  message: string;
  filesWritten: number;
  errors: number;
  warnings: number;
  diagnostics: unknown;
  /** The log line's number (from 1, per run), time (ISO-8601) and level; absent on `STATUS` events. */
  n?: number;
  time?: string;
  level?: string;
}

function parseNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Parses a single SSE frame (already split on `\n\n`) into a
 * `GenerationRunEvent`, or null if the frame carries no usable `data` line.
 *
 * Handles the multi-line `data:` convention and the optional single leading
 * space mandated by the SSE spec. Exported for unit testing.
 */
export function parseGenerationFrame(raw: string): GenerationRunEvent | null {
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue;
    }
    let value = line.slice(5);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    dataLines.push(value);
  }
  if (dataLines.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
    const n = parsed['n'];
    return {
      ...(typeof n === 'number' && Number.isFinite(n) ? { n } : {}),
      ...(parseString(parsed['time']) ? { time: parseString(parsed['time']) } : {}),
      ...(parseString(parsed['level']) ? { level: parseString(parsed['level']) } : {}),
      stage: parseString(parsed['stage']) || 'STATUS',
      message: parseString(parsed['message']),
      filesWritten: parseNumber(parsed['filesWritten']),
      errors: parseNumber(parsed['errors']),
      warnings: parseNumber(parsed['warnings']),
      diagnostics: parsed['diagnostics'] ?? null,
    };
  } catch {
    return null;
  }
}

/** Per-connection harness created by {@link streamGenerationEvents}. */
export interface GenerationStream {
  events: Observable<GenerationRunEvent>;
  close: () => void;
}

const BACKOFF_MS = [1000, 2000, 4000];

/**
 * Opens the generation progress Server-Sent Events stream using the browser
 * `fetch` API (rather than `EventSource`, which cannot carry the
 * `Authorization` header) and re-emits decoded frames as an RxJS Observable.
 *
 * The stream auto-reconnects with 1s -> 2s -> 4s backoff whenever the network
 * drops while the run is still being served; it completes when the server
 * closes the connection normally (run finished) or when {@link close} is
 * invoked (on unsubscription).
 */
export function streamGenerationEvents(
  url: string,
  token: string,
): GenerationStream {
  const controller = new AbortController();
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const events = new Observable<GenerationRunEvent>((subscriber) => {
    let attempt = 0;

    const consume = async (): Promise<void> => {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`SSE stream failed with status ${response.status}`);
        }
        if (!response.body) {
          throw new Error('SSE response has no readable body');
        }

        attempt = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const event = parseGenerationFrame(frame);
            if (event) {
              subscriber.next(event);
            }
          }
        }

        buffer += decoder.decode();
        if (buffer.trim() !== '') {
          const event = parseGenerationFrame(buffer);
          if (event) {
            subscriber.next(event);
          }
        }

        // The server closes the stream once the run reaches a terminal state.
        subscriber.complete();
      } catch (err) {
        if (disposed || controller.signal.aborted) {
          subscriber.complete();
          return;
        }
        const delay =
          BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? BACKOFF_MS.at(-1) ?? 4000;
        attempt += 1;
        retryTimer = setTimeout(() => void consume(), delay);
      }
    };

    void consume();

    return () => {
      disposed = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
      controller.abort();
    };
  });

  return {
    events,
    close: () => controller.abort(),
  };
}
