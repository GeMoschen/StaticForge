import '@testing-library/jest-dom/vitest';
import 'zone.js';
import 'zone.js/testing';

// jsdom implements neither `URL.createObjectURL` nor `URL.revokeObjectURL`. Components that hand
// the browser a generated file (export download, media previews) call them, and specs that assert
// on the download need something to spy on — `vi.spyOn` throws on a missing property.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:jsdom-stub';
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => undefined;
}

// Wire Angular's fakeAsync/ProxyZone machinery into Vitest so that TestBed,
// @testing-library/angular and fakeAsync work (equivalent to what the
// Analog setup-vitest shim does). This patching MUST happen before
// `@angular/core/testing` is imported so that its global test hooks are
// captured in the zone-wrapped form — hence the dynamic import below.
const ambient = globalThis as any;
const ZoneCtor = ambient.Zone;
const ambientZone = ZoneCtor.current;

const syncZone = ambientZone.fork(new ZoneCtor.SyncTestZoneSpec('vitest.describe'));
const testProxyZone = ambientZone.fork(new ZoneCtor.ProxyZoneSpec());

const wrapDescribeInZone = (body: (...args: any[]) => void) => {
  return function (...args: any[]) {
    return syncZone.run(body, null, args);
  };
};

const wrapTestInZone = (body?: (...args: any[]) => void) => {
  if (body === undefined) {
    return undefined;
  }
  return function (...args: any[]) {
    return testProxyZone.run(body, null, args);
  };
};

const bindDescribe =
  (self: any, original: (...a: any[]) => any) =>
  (...eachArgs: any[]) => {
    return function (...args: any[]) {
      args[1] = wrapDescribeInZone(args[1]);
      return original.apply(self, eachArgs).apply(self, args);
    };
  };

const bindTest =
  (self: any, original: (...a: any[]) => any) =>
  (...eachArgs: any[]) => {
    return function (...args: any[]) {
      args[1] = wrapTestInZone(args[1]);
      return original.apply(self, eachArgs).apply(self, args);
    };
  };

const originalDescribe = ambient['describe'];
ambient['describe'] = function (...args: any[]) {
  if (typeof args[1] === 'function') {
    args[1] = wrapDescribeInZone(args[1]);
  }
  return originalDescribe.apply(this, args);
};
ambient['describe'].each = bindDescribe(originalDescribe, originalDescribe.each);
ambient['describe'].only = bindDescribe(originalDescribe, originalDescribe.only);
ambient['describe'].skip = bindDescribe(originalDescribe, originalDescribe.skip);

for (const method of ['test', 'it']) {
  const original = ambient[method];
  ambient[method] = function (...args: any[]) {
    if (typeof args[1] === 'function') {
      args[1] = wrapTestInZone(args[1]);
    }
    return original.apply(this, args);
  };
  ambient[method].each = bindTest(original, original.each);
  ambient[method].only = bindTest(original, original.only);
  ambient[method].skip = bindTest(original, original.skip);
  if (original.todo) {
    ambient[method].todo = (...args: any[]) => original.todo.apply(original, args);
  }
}

for (const method of ['beforeEach', 'afterEach', 'beforeAll', 'afterAll']) {
  const original = ambient[method];
  ambient[method] = function (...args: any[]) {
    if (typeof args[0] === 'function') {
      args[0] = wrapTestInZone(args[0]);
    }
    return original.apply(this, args);
  };
}

// Imported at module scope — *after* the patching above, but still while Vitest is collecting,
// never from inside a hook: `@angular/core/testing` registers the global `beforeEach`/`afterEach`
// that reset the TestBed between tests as a side effect of being loaded. Loading it from a
// `beforeAll` callback happens too late for those hooks to be picked up, and every spec driving
// TestBed directly then fails with "Cannot configure the test module when the test module has
// already been instantiated".
const { getTestBed } = await import('@angular/core/testing');
const {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} = await import('@angular/platform-browser-dynamic/testing');

getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);

// jsdom has no layout: CodeMirror (the code editors, M33) measures text ranges, which jsdom's Range lacks.
if (typeof Range !== 'undefined') {
  const emptyRect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect ??= () => emptyRect as DOMRect;
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
}

// The code editors load CodeMirror as a lazy chunk; preloaded here, editors are created synchronously in specs.
await (await import('./app/shared/code-editor/code-editor.loader')).loadCodeEditorSetup();
