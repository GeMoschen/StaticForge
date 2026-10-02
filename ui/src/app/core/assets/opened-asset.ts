const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The asset a project URL has open. */
export interface OpenedAsset {
  readonly projectKey: string;
  readonly uuid: string;
}

/**
 * The asset a router URL has open (M35.15), or `null` when it shows none: a page (`/p/acme/pages/<uuid>`), a record or
 * record set (`/content/records|sets/<uuid>`), or — in the stores that keep the open item in the query — `?asset=<uuid>`
 * (media, navigation, globals, templates) and `?folder=<uuid>` (a folder of any store). Pure.
 */
export function openedAsset(url: string): OpenedAsset | null {
  const hash = url.indexOf('#');
  const clean = hash < 0 ? url : url.slice(0, hash);
  const mark = clean.indexOf('?');
  const path = mark < 0 ? clean : clean.slice(0, mark);
  const rest = mark < 0 ? '' : clean.slice(mark + 1);
  const segments = path.split('/').filter(Boolean).map(decodeSegment);
  if (segments[0] !== 'p' || segments[1] === undefined) {
    return null;
  }
  const projectKey = segments[1];
  const [section, a, b] = [segments[2], segments[3], segments[4]];
  const query = new URLSearchParams(rest);
  const candidates: (string | null | undefined)[] = [];
  if (section === 'pages') {
    candidates.push(a);
  } else if (section === 'content' && (a === 'records' || a === 'sets')) {
    candidates.push(b);
  }
  if (section === 'pages' || section === 'content' || section === 'media' || section === 'navigation' || section === 'globals' || section === 'templates') {
    candidates.push(query.get('asset'), query.get('folder'));
  }
  const uuid = candidates.find((value): value is string => !!value && UUID.test(value));
  return uuid ? { projectKey, uuid } : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
