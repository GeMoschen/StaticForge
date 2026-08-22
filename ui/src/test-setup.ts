import '@testing-library/jest-dom/vitest';
import 'zone.js';
import 'zone.js/testing';

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

ambient['beforeAll'](async () => {
  const { getTestBed } = await import('@angular/core/testing');
  const {
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting,
  } = await import('@angular/platform-browser-dynamic/testing');

  getTestBed().initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
  );
});
