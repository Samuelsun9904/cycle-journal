const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const elements = new Map();
function element(selector) {
  if (!elements.has(selector)) elements.set(selector, {
    hidden: false, disabled: false, value: "", textContent: "", dataset: {},
    addEventListener() {}
  });
  return elements.get(selector);
}

const storage = new Map();
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};

let authListener;
let activeCouple = { id: "couple-a", owner_id: "user-a", partner_id: "user-p", invite_code: "ABCDEFGH" };
const remote = new Map(Array.from({ length: 1201 }, (_, index) => {
  const date = new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10);
  return [date, { record_date: date, payload: { note: `remote-${index}` }, deleted_at: null, updated_at: new Date().toISOString() }];
}));
remote.set("2019-12-31", {
  record_date: "2019-12-31", payload: { note: "old deleted private payload" },
  deleted_at: new Date().toISOString(), updated_at: new Date().toISOString()
});
let releaseFirstUpsert;
let firstUpsertStarted;
const firstUpsertGate = new Promise(resolve => { firstUpsertStarted = resolve; });
let delayNextUpsert = false;
let failNextUpsert = false;
const uploadedBatches = [];
let pageRequests = 0;
const pageStarts = [];
const loggedErrors = [];

function couplesQuery() {
  return {
    select() { return this; },
    or() { return this; },
    maybeSingle: async () => ({ data: activeCouple, error: null }),
    insert() { return this; },
    single: async () => ({ data: activeCouple, error: null })
  };
}

function recordsQuery() {
  const query = {
    update(values) { this.updateValues = values; return this; },
    select() { return this; },
    eq() { return this; },
    in(_column, values) { this.matchingDates = values; return this; },
    not: async function () {
      (this.matchingDates || []).forEach(date => {
        const row = remote.get(date);
        if (row?.deleted_at) remote.set(date, { ...row, ...this.updateValues, updated_at: new Date().toISOString() });
      });
      return { error: null };
    },
    order() { return this; },
    range: async (from, to) => {
      pageRequests += 1;
      pageStarts.push(from);
      return { data: [...remote.values()].sort((a, b) => a.record_date.localeCompare(b.record_date)).slice(from, to + 1), error: null };
    },
    upsert: async rows => {
      uploadedBatches.push(rows.map(row => ({ ...row })));
      if (failNextUpsert) {
        failNextUpsert = false;
        return { error: new Error("offline") };
      }
      if (delayNextUpsert) {
        delayNextUpsert = false;
        firstUpsertStarted();
        await new Promise(resolve => { releaseFirstUpsert = resolve; });
      }
      rows.forEach(row => remote.set(row.record_date, { ...row, updated_at: new Date().toISOString() }));
      return { error: null };
    }
  };
  return query;
}

const client = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "user-a", email: "a@example.com" } } }, error: null }),
    onAuthStateChange(callback) { authListener = callback; },
    signInWithPassword: async () => ({ error: null }),
    signUp: async () => ({ data: { session: {} }, error: null }),
    signOut: async () => { authListener("SIGNED_OUT", null); }
  },
  from(table) { return table === "couples" ? couplesQuery() : recordsQuery(); },
  rpc: async () => ({ data: activeCouple, error: null }),
  channel() {
    return { on() { return this; }, subscribe(callback) { callback("SUBSCRIBED"); return this; } };
  },
  removeChannel: async () => {}
};

const context = {
  console: { ...console, error: error => loggedErrors.push(String(error?.message || error)) },
  crypto: webcrypto,
  Intl,
  navigator: { onLine: true, clipboard: { writeText: async () => {} } },
  localStorage,
  document: { hidden: false, querySelector: element, addEventListener() {} },
  setTimeout,
  clearTimeout,
  queueMicrotask,
  window: null
};
context.window = context;
context.window.addEventListener = () => {};
context.window.CYCLE_JOURNAL_CONFIG = { supabaseUrl: "https://example.test", supabasePublishableKey: "public" };
context.window.supabase = { createClient: () => client };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../cloud.js"), "utf8"), context);

let records = { "2026-09-06": { note: "local record missed by the old sync queue" } };
const scopes = [];
const app = {
  getSnapshot: () => ({ records }),
  replaceRecords: async next => { records = structuredClone(next); },
  switchStorageScope: async (scope, options) => { scopes.push({ scope, options }); return { adopted: Boolean(options?.adoptCurrent) }; },
  onRoleChange() {},
  notify() {}
};

(async () => {
  await context.CloudSync.initialize(app);
  assert.equal(Object.keys(records).length, 1202, "paginated cloud rows and unsynced legacy local rows should be merged");
  assert.equal(remote.get("2026-09-06").payload.note, "local record missed by the old sync queue");
  assert.ok(pageRequests >= 3);
  assert.ok(pageStarts.includes(1000), "pagination must request rows beyond Supabase's first 1000 results");
  assert.equal(remote.get("2019-12-31").payload, null, "legacy tombstones should be scrubbed without restoring them");
  assert.equal(scopes[0].scope, "user:user-a");
  assert.equal(scopes[1].scope, "couple:couple-a");

  records["2026-09-07"] = { note: "first save" };
  context.CloudSync.schedulePush(["2026-09-07"]);
  delayNextUpsert = true;
  const syncing = context.CloudSync.syncNow();
  await firstUpsertGate;
  records["2026-09-08"] = { note: "saved during sync" };
  context.CloudSync.schedulePush(["2026-09-08"]);
  releaseFirstUpsert();
  assert.equal(await syncing, true);
  assert.equal(remote.get("2026-09-07").payload.note, "first save");
  assert.equal(remote.get("2026-09-08").payload.note, "saved during sync", "a save made during sync must be queued");

  delete records["2026-09-07"];
  context.CloudSync.schedulePush(["2026-09-07"]);
  await context.CloudSync.syncNow();
  assert.equal(remote.get("2026-09-07").payload, null, "deleted records must not retain private payloads");
  assert.ok(remote.get("2026-09-07").deleted_at);

  records["2026-09-09"] = { note: "retry me" };
  context.CloudSync.schedulePush(["2026-09-09"]);
  failNextUpsert = true;
  assert.equal(await context.CloudSync.syncNow(), false, "a failed upload must be reported");
  assert.ok(loggedErrors.includes("offline"));
  const failedMeta = JSON.parse(storage.get("cycle-journal-cloud-meta-v2:couple-a"));
  assert.ok(failedMeta.pendingDates.includes("2026-09-09"), "failed dates must remain pending");
  assert.equal(await context.CloudSync.syncNow(), true, "manual retry should flush pending changes");
  assert.equal(remote.get("2026-09-09").payload.note, "retry me");

  await authListener("SIGNED_OUT", null);
  await new Promise(resolve => setTimeout(resolve, 0));
  activeCouple = { id: "couple-b", owner_id: "user-b", partner_id: null, invite_code: "BCDEFGHJ" };
  authListener("SIGNED_IN", { user: { id: "user-b", email: "b@example.com" } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scopes.at(-1).scope, "couple:couple-b");
  const secondAccountScope = scopes.find(entry => entry.scope === "user:user-b");
  assert.notEqual(secondAccountScope.options?.adoptCurrent, true, "a second account must not adopt the previous account's records");

  assert.ok(uploadedBatches.length >= 3);
  console.log("cloud sync regression tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
