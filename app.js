const STORAGE_KEY = "cycle-journal-v1";
const DRAFT_KEY = "cycle-journal-drafts-v1";
const PRE_V9_BACKUP_KEY = "cycle-journal-pre-v9-backup";
const SNAPSHOT_DB = "cycle-journal-storage";
const STORAGE_VERSION = 4;
const RELEASE_NOTES_KEY = "cycle-journal-release-v13";
const BACKUP_ITERATIONS = 250000;
const SYMPTOMS = [
  { id: "bloating", label: "腹胀" }, { id: "acne", label: "痘痘" },
  { id: "tired", label: "疲惫" }, { id: "lowMood", label: "情绪低落" },
  { id: "irritable", label: "烦躁" }, { id: "poorSleep", label: "睡眠不佳" },
  { id: "appetite", label: "食欲变化" }, { id: "discharge", label: "分泌物变化" }
];
const PAIN_TYPES = [
  { id: "cramps", label: "腹部绞痛", icon: "circle-gauge" }, { id: "ovulation", label: "排卵痛", icon: "scan-line" },
  { id: "breast", label: "乳房胀痛", icon: "heart-pulse" }, { id: "headache", label: "头痛", icon: "brain" },
  { id: "backache", label: "腰背痛", icon: "accessibility" }, { id: "joint", label: "关节酸痛", icon: "bone" }
];
const PARTNER_RESPONSES = [
  { id: "seen", label: "看到了", icon: "check" },
  { id: "hug", label: "抱抱你", icon: "heart" },
  { id: "care", label: "今晚我来照顾你", icon: "sparkles" },
  { id: "prepare", label: "需要我准备什么？", icon: "circle-help" }
];
const LEGACY_PAIN_IDS = new Set(["cramps", "headache", "backache", "breast"]);
const DEFAULT_SETTINGS = {
  lastBackupAt: null, reminderEnabled: false, reminderDays: 1, reminderTime: "09:00", lastReminderKey: null,
  partnerName: "", partnerMessage: "", partnerShareCycle: true, partnerShareBody: true, partnerShareMood: true
};

let storageScope = "local";
const stored = loadStore(storageScope);
let persistedRecordSignatures = recordSignatures(stored.records);
const state = {
  month: startOfMonth(new Date()), selectedDate: null, records: stored.records,
  settings: stored.settings, calendarFilter: "all", periodRangeOriginal: null,
  pendingImport: null, backupMode: "export", intimacyMode: "count", sexCount: 0, sexMinutes: 0,
  partnerSummaryBlob: null, cloudRole: "local", partnerResponses: {},
  responsesEnabled: false, responsesAvailable: false, responsesPaired: false, detailDate: null
};

const elements = {
  monthTitle: document.querySelector("#monthTitle"), cycleSummary: document.querySelector("#cycleSummary"),
  calendarGrid: document.querySelector("#calendarGrid"), recordDialog: document.querySelector("#recordDialog"),
  recordDateTitle: document.querySelector("#recordDateTitle"), sexAmountInput: document.querySelector("#sexAmountInput"),
  intimacyAmountLabel: document.querySelector("#intimacyAmountLabel"), intimacyAmountHint: document.querySelector("#intimacyAmountHint"),
  intimacyAmountStepper: document.querySelector("#intimacyAmountStepper"),
  spotting: document.querySelector("#spottingInput"), protectionRow: document.querySelector("#protectionRow"),
  flowFieldset: document.querySelector("#flowFieldset"), note: document.querySelector("#noteInput"),
  customTags: document.querySelector("#customTagsInput"), deleteRecord: document.querySelector("#deleteRecord"),
  editPeriodRange: document.querySelector("#editPeriodRange"), symptomOptions: document.querySelector("#symptomOptions"),
  metrics: document.querySelector("#metrics"), historyList: document.querySelector("#historyList"),
  cycleChart: document.querySelector("#cycleChart"), symptomSummary: document.querySelector("#symptomSummary"),
  todayCycleLabel: document.querySelector("#todayCycleLabel"), todayStatus: document.querySelector("#todayStatus"),
  todayForecast: document.querySelector("#todayForecast"), confidenceBadge: document.querySelector("#confidenceBadge"),
  todayRecord: document.querySelector("#todayRecord"), backupReminder: document.querySelector("#backupReminder"),
  ringProgress: document.querySelector("#ringProgress"), ringPeriod: document.querySelector("#ringPeriod"),
  ringPrediction: document.querySelector("#ringPrediction"), ringPhase: document.querySelector("#ringPhase"),
  ringDay: document.querySelector("#ringDay"), ringCaption: document.querySelector("#ringCaption"),
  backupStatus: document.querySelector("#backupStatus"), periodRangeDialog: document.querySelector("#periodRangeDialog"),
  periodStart: document.querySelector("#periodStartInput"), periodEnd: document.querySelector("#periodEndInput"),
  deletePeriodRange: document.querySelector("#deletePeriodRange"), backupDialog: document.querySelector("#backupDialog"),
  backupPassword: document.querySelector("#backupPassword"), backupPasswordConfirm: document.querySelector("#backupPasswordConfirm"),
  backupError: document.querySelector("#backupError"), recordWeekStrip: document.querySelector("#recordWeekStrip"),
  painTypeOptions: document.querySelector("#painTypeOptions"), guidanceTitle: document.querySelector("#guidanceTitle"),
  guidanceCopy: document.querySelector("#guidanceCopy"), reminderEnabled: document.querySelector("#reminderEnabled"),
  reminderControls: document.querySelector("#reminderControls"), reminderDays: document.querySelector("#reminderDays"),
  reminderTime: document.querySelector("#reminderTime"), reminderStatus: document.querySelector("#reminderStatus"),
  monthlySexTotal: document.querySelector("#monthlySexTotal"), monthlySexMinutes: document.querySelector("#monthlySexMinutes"),
  monthlySexDays: document.querySelector("#monthlySexDays"),
  monthlyUnprotectedDays: document.querySelector("#monthlyUnprotectedDays"), monthlyProtectionCopy: document.querySelector("#monthlyProtectionCopy"),
  intimacyMonthLabel: document.querySelector("#intimacyMonthLabel"), partnerName: document.querySelector("#partnerNameInput"),
  partnerMessage: document.querySelector("#partnerMessageInput"), shareCycle: document.querySelector("#shareCycleInput"),
  shareBody: document.querySelector("#shareBodyInput"), shareMood: document.querySelector("#shareMoodInput"),
  partnerSummaryDialog: document.querySelector("#partnerSummaryDialog"), partnerSummaryPreview: document.querySelector("#partnerSummaryPreview"),
  regularityArc: document.querySelector("#regularityArc"), regularityValue: document.querySelector("#regularityValue"),
  analysisVerdict: document.querySelector("#analysisVerdict"), analysisCopy: document.querySelector("#analysisCopy"),
  changeSummary: document.querySelector("#changeSummary"), flowHistory: document.querySelector("#flowHistory"),
  recordDetailDialog: document.querySelector("#recordDetailDialog"), recordDetailTitle: document.querySelector("#recordDetailTitle"),
  recordDetailBody: document.querySelector("#recordDetailBody"), monthPickerDialog: document.querySelector("#monthPickerDialog"),
  intimacyYearSelect: document.querySelector("#intimacyYearSelect"), intimacyMonthSelect: document.querySelector("#intimacyMonthSelect"),
  todayPartnerResponse: document.querySelector("#todayPartnerResponse"), recordFormResponse: document.querySelector("#recordFormResponse"),
  partnerResponsePanel: document.querySelector("#partnerResponsePanel"), partnerResponseOptions: document.querySelector("#partnerResponseOptions"),
  partnerResponseHint: document.querySelector("#partnerResponseHint"), responseSettings: document.querySelector("#responseSettings"),
  responseSettingsHint: document.querySelector("#responseSettingsHint"), responsesEnabled: document.querySelector("#responsesEnabledInput"),
  customResponse: document.querySelector("#customResponseInput"), sendCustomResponse: document.querySelector("#sendCustomResponse"),
  releaseDialog: document.querySelector("#releaseDialog"), closeReleaseDialog: document.querySelector("#closeReleaseDialog"),
  toast: document.querySelector("#toast")
};

initialize();

async function initialize() {
  document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long", day: "numeric", weekday: "long"
  }).format(new Date());
  renderSymptomOptions(); renderPainTypeOptions();
  bindEvents();
  render();
  refreshIcons();
  window.setTimeout(showReleaseNotes, 500);
  await recoverIndexedSnapshot();
  window.CloudSync?.initialize({
    getSnapshot: () => ({ records: state.records }),
    replaceRecords,
    switchStorageScope,
    replacePartnerResponses,
    setPartnerResponseContext,
    onRoleChange: applyCloudRole,
    notify: showToast
  });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
      navigator.serviceWorker.addEventListener("controllerchange", () => showToast("新版本已就绪，下次打开生效"));
    });
  }
  window.addEventListener("load", checkPredictionReminder);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkPredictionReminder(); });
}

function bindEvents() {
  document.querySelector("#previousMonth").addEventListener("click", () => changeMonth(-1));
  document.querySelector("#nextMonth").addEventListener("click", () => changeMonth(1));
  document.querySelector("#todayButton").addEventListener("click", () => {
    state.month = startOfMonth(new Date()); showView("todayView"); render();
  });
  document.querySelectorAll(".tab").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => {
    state.calendarFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach(item => item.classList.toggle("active", item === button));
    renderCalendar();
  }));
  document.querySelectorAll('input[name="period"]').forEach(input => input.addEventListener("change", updateFormVisibility));
  document.querySelectorAll('input[name="pain"]').forEach(input => input.addEventListener("change", syncPainSelection));
  document.querySelectorAll('input[name="intimacyMode"]').forEach(input => input.addEventListener("change", changeIntimacyMode));
  document.querySelector("#recordForm").addEventListener("input", saveRecordDraft);
  document.querySelector("#recordForm").addEventListener("change", saveRecordDraft);
  document.querySelector("#decreaseSexCount").addEventListener("click", () => changeSexCount(-1));
  document.querySelector("#increaseSexCount").addEventListener("click", () => changeSexCount(1));
  elements.sexAmountInput.addEventListener("input", updateIntimacyAmountFromInput);
  document.querySelector("#saveRecord").addEventListener("click", saveCurrentRecord);
  elements.deleteRecord.addEventListener("click", deleteCurrentRecord);
  elements.editPeriodRange.addEventListener("click", editSelectedPeriodRange);
  document.querySelector("#logTodayButton").addEventListener("click", () => openRecordDialog(new Date()));
  document.querySelector("#recordFab").addEventListener("click", () => openRecordDialog(new Date()));
  document.querySelector("#editTodayButton").addEventListener("click", () => openRecordForRole(new Date()));
  document.querySelector("#logPeriodRangeButton").addEventListener("click", () => openPeriodRangeDialog(new Date()));
  document.querySelector("#savePeriodRange").addEventListener("click", savePeriodRange);
  elements.deletePeriodRange.addEventListener("click", deleteCurrentPeriodRange);
  document.querySelector("#exportButton").addEventListener("click", () => openBackupDialog("export"));
  elements.backupReminder.addEventListener("click", () => openBackupDialog("export"));
  document.querySelector("#confirmBackupAction").addEventListener("click", runBackupAction);
  document.querySelector("#importInput").addEventListener("change", importData);
  document.querySelector("#calendarExportButton").addEventListener("click", exportPredictionCalendar);
  elements.reminderEnabled.addEventListener("change", handleReminderToggle);
  elements.reminderDays.addEventListener("change", saveReminderSettings);
  elements.reminderTime.addEventListener("change", saveReminderSettings);
  document.querySelector("#testReminderButton").addEventListener("click", testReminder);
  [elements.partnerName, elements.partnerMessage, elements.shareCycle, elements.shareBody, elements.shareMood]
    .forEach(input => input.addEventListener("change", savePartnerSettings));
  document.querySelector("#previewPartnerSummaryButton").addEventListener("click", openPartnerSummary);
  document.querySelector("#closePartnerSummary").addEventListener("click", () => elements.partnerSummaryDialog.close());
  document.querySelector("#downloadPartnerSummary").addEventListener("click", downloadPartnerSummary);
  document.querySelector("#sharePartnerSummary").addEventListener("click", sharePartnerSummary);
  document.querySelector("#clearButton").addEventListener("click", () => document.querySelector("#confirmDialog").showModal());
  document.querySelector("#confirmClear").addEventListener("click", clearAllData);
  document.querySelector("#previousIntimacyMonth").addEventListener("click", () => changeMonth(-1));
  document.querySelector("#nextIntimacyMonth").addEventListener("click", () => changeMonth(1));
  document.querySelector("#currentIntimacyMonth").addEventListener("click", () => { state.month = startOfMonth(new Date()); renderCalendar(); });
  elements.intimacyMonthLabel.addEventListener("click", openMonthPicker);
  document.querySelector("#applyIntimacyMonth").addEventListener("click", applyIntimacyMonth);
  document.querySelector("#closeRecordDetail").addEventListener("click", () => elements.recordDetailDialog.close());
  elements.responsesEnabled.addEventListener("change", changeResponsesEnabled);
  elements.sendCustomResponse.addEventListener("click", sendCustomPartnerResponse);
  elements.customResponse.addEventListener("keydown", event => { if (event.key === "Enter") sendCustomPartnerResponse(); });
  elements.closeReleaseDialog.addEventListener("click", closeReleaseNotes);
}

function storageKey(baseKey, scope = storageScope) {
  return scope === "local" ? baseKey : `${baseKey}:${scope}`;
}

function loadStore(scope = storageScope, options = {}) {
  const defaults = { records: {}, settings: { ...DEFAULT_SETTINGS } };
  try {
    const raw = localStorage.getItem(storageKey(STORAGE_KEY, scope));
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.records !== "object") return defaults;
    const backupKey = storageKey(PRE_V9_BACKUP_KEY, scope);
    if (options.createBackup !== false && raw && !localStorage.getItem(backupKey)) {
      try { localStorage.setItem(backupKey, raw); }
      catch (error) { console.warn("Pre-v9 backup could not be stored", error); }
    }
    const records = Object.fromEntries(Object.entries(parsed.records).map(([key, record]) => [key, normalizeRecord(record)]));
    return { records, settings: { ...defaults.settings, ...(parsed.settings || {}) } };
  } catch { return defaults; }
}

function normalizeRecord(record = {}) {
  const allowed = (value, values) => values.includes(value) ? value : null;
  const legacyPainTypes = Array.isArray(record.symptoms) ? record.symptoms.filter(id => LEGACY_PAIN_IDS.has(id)) : [];
  const sexCount = clamp(Number.isFinite(Number(record.sexCount)) ? Math.round(Number(record.sexCount)) : record.hadSex ? 1 : 0, 0, 9);
  const sexMinutes = clamp(Number.isFinite(Number(record.sexMinutes)) ? Math.round(Number(record.sexMinutes)) : 0, 0, 600);
  const intimacyMode = record.intimacyMode === "duration" ? "duration" : "count";
  const hasIntimacy = intimacyMode === "duration" ? sexMinutes > 0 : sexCount > 0;
  const legacyProtection = { yes: "all", no: "none" }[record.protection] || record.protection;
  return {
    ...record,
    period: record.period || "none", flow: allowed(record.flow, ["light", "medium", "heavy", "veryHeavy"]), spotting: Boolean(record.spotting),
    energy: allowed(record.energy, ["exhausted", "low", "normal", "high"]),
    pain: allowed(record.pain, ["none", "mild", "moderate", "severe"]),
    mood: allowed(record.mood, ["low", "calm", "sensitive", "irritable"]),
    intimacyMode, sexCount, sexMinutes, hadSex: hasIntimacy,
    protection: hasIntimacy ? allowed(legacyProtection, ["all", "partial", "none", "unknown"]) || "unknown" : null,
    painTypes: [...new Set([...(Array.isArray(record.painTypes) ? record.painTypes : []), ...legacyPainTypes])].filter(id => PAIN_TYPES.some(item => item.id === id)),
    symptoms: Array.isArray(record.symptoms) ? record.symptoms.filter(id => SYMPTOMS.some(item => item.id === id)) : [],
    customTags: Array.isArray(record.customTags) ? record.customTags.filter(Boolean) : [],
    note: typeof record.note === "string" ? record.note : ""
  };
}

function persist(options = {}) {
  const snapshot = { version: STORAGE_VERSION, records: state.records, settings: state.settings };
  const nextSignatures = recordSignatures(state.records);
  const changedDates = changedRecordDates(persistedRecordSignatures, nextSignatures);
  localStorage.setItem(storageKey(STORAGE_KEY), JSON.stringify(snapshot));
  persistedRecordSignatures = nextSignatures;
  const snapshotPromise = saveIndexedSnapshot(snapshot);
  if (options.cloud !== false && changedDates.length) window.CloudSync?.schedulePush(changedDates);
  return snapshotPromise;
}

function recordSignatures(records) {
  return new Map(Object.entries(records || {}).map(([key, record]) => [key, JSON.stringify(record)]));
}

function changedRecordDates(previous, next) {
  const dates = new Set([...previous.keys(), ...next.keys()]);
  return [...dates].filter(key => previous.get(key) !== next.get(key));
}

function openSnapshotDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SNAPSHOT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveIndexedSnapshot(snapshot, scope = storageScope) {
  try {
    const db = await openSnapshotDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").put(snapshot, scope);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (error) { console.warn("IndexedDB snapshot failed", error); }
}

async function deleteIndexedSnapshot(key) {
  try {
    const db = await openSnapshotDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (error) { console.warn("IndexedDB snapshot cleanup failed", error); }
}

async function recoverIndexedSnapshot() {
  try {
    const db = await openSnapshotDb();
    const snapshot = await new Promise((resolve, reject) => {
      const store = db.transaction("snapshots").objectStore("snapshots");
      const request = store.get(storageScope);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    let recovered = snapshot;
    if (!recovered && storageScope === "local") {
      recovered = await new Promise((resolve, reject) => {
        const request = db.transaction("snapshots").objectStore("snapshots").get("latest");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    if (!Object.keys(state.records).length && recovered?.records && Object.keys(recovered.records).length) {
      state.records = normalizeRecords(recovered.records);
      state.settings = { ...DEFAULT_SETTINGS, ...(recovered.settings || {}) };
      persistedRecordSignatures = recordSignatures(state.records);
      persist({ cloud: false }); render(); showToast("已从设备快照恢复记录");
    } else if (!recovered) saveIndexedSnapshot({ version: STORAGE_VERSION, records: state.records, settings: state.settings });
  } catch (error) { console.warn("IndexedDB recovery failed", error); }
}

function normalizeRecords(records) {
  return Object.fromEntries(Object.entries(records || {}).map(([key, record]) => [key, normalizeRecord(record)]));
}

async function replaceRecords(records) {
  state.records = normalizeRecords(records);
  persist({ cloud: false }); render();
}

async function switchStorageScope(nextScope, options = {}) {
  if (!nextScope || nextScope === storageScope) return { adopted: false };
  const previousScope = storageScope;
  const previousSnapshot = { version: STORAGE_VERSION, records: state.records, settings: state.settings };
  const targetKey = storageKey(STORAGE_KEY, nextScope);
  const targetExists = Boolean(localStorage.getItem(targetKey));
  const adopted = Boolean(options.adoptCurrent && !targetExists);

  if (adopted) {
    localStorage.setItem(targetKey, JSON.stringify(previousSnapshot));
    const previousDrafts = localStorage.getItem(storageKey(DRAFT_KEY, previousScope));
    if (previousDrafts) localStorage.setItem(storageKey(DRAFT_KEY, nextScope), previousDrafts);
    const previousBackup = localStorage.getItem(storageKey(PRE_V9_BACKUP_KEY, previousScope));
    if (previousBackup) localStorage.setItem(storageKey(PRE_V9_BACKUP_KEY, nextScope), previousBackup);
  }

  if (options.clearSource && (adopted || options.forceClearSource)) {
    const emptySnapshot = { version: STORAGE_VERSION, records: {}, settings: { ...DEFAULT_SETTINGS } };
    localStorage.setItem(storageKey(STORAGE_KEY, previousScope), JSON.stringify(emptySnapshot));
    localStorage.removeItem(storageKey(DRAFT_KEY, previousScope));
    localStorage.removeItem(storageKey(PRE_V9_BACKUP_KEY, previousScope));
    await saveIndexedSnapshot(emptySnapshot, previousScope);
    if (previousScope === "local") await deleteIndexedSnapshot("latest");
  }

  storageScope = nextScope;
  const storedScope = loadStore(nextScope);
  state.records = normalizeRecords(storedScope.records);
  state.settings = { ...DEFAULT_SETTINGS, ...storedScope.settings };
  persistedRecordSignatures = recordSignatures(state.records);
  await saveIndexedSnapshot({ version: STORAGE_VERSION, records: state.records, settings: state.settings });
  if (elements.recordDialog.open) elements.recordDialog.close();
  render();
  return { adopted };
}

function applyCloudRole(role) {
  state.cloudRole = role;
  const readOnly = role === "partner";
  document.body.classList.toggle("partner-readonly", readOnly);
  ["#logTodayButton", "#logPeriodRangeButton", "#recordFab", "#clearButton"].forEach(selector => {
    const button = document.querySelector(selector); if (button) button.disabled = readOnly;
  });
  const todayButton = document.querySelector("#editTodayButton");
  todayButton.disabled = false; todayButton.textContent = readOnly ? "查看" : "编辑";
  if (readOnly && elements.recordDialog.open) elements.recordDialog.close();
  renderResponseSettings();
}

function setPartnerResponseContext(context = {}) {
  state.responsesEnabled = Boolean(context.enabled);
  state.responsesAvailable = Boolean(context.available);
  state.responsesPaired = Boolean(context.paired);
  renderResponseSettings();
  renderTodayResponse();
  if (elements.recordDetailDialog.open && state.detailDate) renderPartnerResponsePanel(state.detailDate, state.records[state.detailDate]);
}

function replacePartnerResponses(responses = {}) {
  state.partnerResponses = Object.fromEntries(Object.entries(responses).filter(([, response]) =>
    PARTNER_RESPONSES.some(option => option.id === response?.type) || (response?.type === "custom" && response.text)
  ));
  renderTodayResponse();
  renderCalendar();
  if (elements.recordDialog.open && state.selectedDate) renderResponseBanner(elements.recordFormResponse, dateKey(state.selectedDate));
  if (elements.recordDetailDialog.open && state.detailDate) renderPartnerResponsePanel(state.detailDate, state.records[state.detailDate]);
}
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseDate(key) { const [year, month, day] = key.split("-").map(Number); return new Date(year, month - 1, day, 12); }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1, 12); }
function addDays(date, count) { const result = new Date(date); result.setDate(result.getDate() + count); return result; }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function isSameDay(a, b) { return dateKey(a) === dateKey(b); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function changeMonth(offset) { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + offset, 1, 12); renderCalendar(); }
function render() {
  renderToday(); renderCalendar(); renderInsights(); renderBackupStatus(); renderReminderSettings(); renderPartnerSettings(); renderResponseSettings();
  queueMicrotask(refreshIcons);
}

function renderToday() {
  const today = new Date();
  const todayRecord = state.records[dateKey(today)];
  const starts = periodStarts().filter(date => date <= today);
  const latestStart = starts.at(-1);
  const cycleDay = latestStart ? daysBetween(latestStart, today) + 1 : null;
  const periodSegment = findPeriodSegment(today);
  const prediction = calculatePrediction();
  renderCycleRing(cycleDay, prediction, periodSegment);
  if (periodSegment) {
    elements.todayCycleLabel.textContent = `当前周期第 ${cycleDay || 1} 天`;
    elements.todayStatus.textContent = `经期第 ${daysBetween(periodSegment.start, today) + 1} 天`;
  } else if (cycleDay && cycleDay > 0 && cycleDay <= 90) {
    elements.todayCycleLabel.textContent = `当前周期第 ${cycleDay} 天`;
    elements.todayStatus.textContent = prediction ? predictionCountdown(prediction, today) : "继续记录，逐渐建立个人规律";
  } else {
    elements.todayCycleLabel.textContent = "等待周期记录";
    elements.todayStatus.textContent = "从今天开始了解身体规律";
  }
  if (prediction) {
    elements.todayForecast.textContent = `下次经期预计在 ${formatRange(prediction.startLower, prediction.startUpper)} 开始。`;
    elements.confidenceBadge.hidden = false;
    elements.confidenceBadge.textContent = prediction.confidenceLabel;
    elements.confidenceBadge.dataset.level = prediction.confidence;
  } else {
    elements.todayForecast.textContent = "记录至少两次经期开始日期后生成预测。";
    elements.confidenceBadge.hidden = true;
  }
  renderTodayGuidance(prediction, periodSegment, today);
  elements.todayRecord.replaceChildren();
  const chips = recordLabels(todayRecord);
  if (!chips.length) {
    const empty = document.createElement("p"); empty.className = "empty-inline"; empty.textContent = "今天还没有记录";
    elements.todayRecord.append(empty);
  } else chips.forEach(label => elements.todayRecord.append(createTag(label)));
  renderTodayResponse();
  const recordCount = Object.keys(state.records).length;
  const lastBackup = state.settings.lastBackupAt ? new Date(state.settings.lastBackupAt) : null;
  elements.backupReminder.hidden = recordCount < 5 || (lastBackup && daysBetween(lastBackup, today) < 30);
}

function renderTodayGuidance(prediction, periodSegment, today) {
  if (periodSegment) {
    elements.guidanceTitle.textContent = "记录今天的经量和感受";
    elements.guidanceCopy.textContent = "连续记录能更清楚地看到每次经期的经量与疼痛变化。"; return;
  }
  if (!prediction) {
    elements.guidanceTitle.textContent = "建立你的周期基线";
    elements.guidanceCopy.textContent = "持续记录经量、感受和疼痛，变化会出现在分析页。"; return;
  }
  const days = daysBetween(today, prediction.start);
  if (days <= 3 && days >= -1) {
    elements.guidanceTitle.textContent = "预计经期临近";
    elements.guidanceCopy.textContent = state.settings.reminderEnabled ? "提醒已开启，也可以导入系统日历获得更可靠的通知。" : "可在设置中开启提醒，或添加到系统日历。";
  } else {
    elements.guidanceTitle.textContent = "留意身体变化";
    elements.guidanceCopy.textContent = "今天的精力、情绪和疼痛会帮助你发现重复出现的模式。";
  }
}

function renderCycleRing(cycleDay, prediction, periodSegment) {
  if (!cycleDay || !prediction || cycleDay < 1 || cycleDay > prediction.cycleLength + 14) {
    document.body.dataset.phase = "waiting";
    setRingArc(elements.ringProgress, 0, 0);
    setRingArc(elements.ringPeriod, 0, 0);
    setRingArc(elements.ringPrediction, 0, 0);
    elements.ringPhase.textContent = "等待记录";
    elements.ringDay.textContent = "--";
    elements.ringCaption.textContent = "周期日";
    return;
  }
  const cycleLength = prediction.cycleLength;
  const progress = clamp(cycleDay / cycleLength, 0, 1);
  setRingArc(elements.ringProgress, 0, progress);
  setRingArc(elements.ringPeriod, 0, clamp(prediction.periodLength / cycleLength, 0, 1));
  const predictionStart = clamp((cycleLength - prediction.variation - 1) / cycleLength, 0, 1);
  const predictionLength = clamp((prediction.variation * 2 + 1) / cycleLength, 0, 1 - predictionStart);
  setRingArc(elements.ringPrediction, predictionStart, predictionLength);
  const ovulationDay = Math.max(prediction.periodLength + 2, cycleLength - 14);
  let phase = "卵泡期 · 估算";
  let phaseKey = "follicular";
  if (periodSegment || cycleDay <= prediction.periodLength) { phase = "经期"; phaseKey = "period"; }
  else if (cycleDay >= ovulationDay - 2 && cycleDay <= ovulationDay + 2) { phase = "排卵附近 · 估算"; phaseKey = "ovulation"; }
  else if (cycleDay > ovulationDay + 2) { phase = "黄体期 · 估算"; phaseKey = "luteal"; }
  document.body.dataset.phase = phaseKey;
  elements.ringPhase.textContent = phase;
  elements.ringDay.textContent = String(cycleDay);
  elements.ringCaption.textContent = `约 ${cycleLength} 天周期`;
}

function setRingArc(circle, start, length) {
  const circumference = 2 * Math.PI * 94;
  circle.style.strokeDasharray = `${circumference * length} ${circumference * (1 - length)}`;
  circle.style.strokeDashoffset = String(-circumference * start);
}

function predictionCountdown(prediction, today) {
  const days = daysBetween(today, prediction.start);
  if (days > 1) return `预计还有约 ${days} 天`;
  if (days >= -1) return "预计经期临近";
  return "本次经期尚未记录";
}

function recordLabels(record) {
  if (!record) return [];
  const labels = [];
  if (record.period && record.period !== "none") labels.push("经期");
  const flow = { light: "经量少", medium: "经量中", heavy: "经量多", veryHeavy: "经量超多" }[record.flow];
  if (flow) labels.push(flow);
  if (record.spotting) labels.push("点滴出血");
  if (record.intimacyMode === "duration" && record.sexMinutes) labels.push(`同房 ${record.sexMinutes} 分钟`);
  else if (record.sexCount) labels.push(`同房 ${record.sexCount} 次`);
  const energy = { exhausted: "精力耗尽", low: "有些疲倦", normal: "精力正常", high: "精力充沛" }[record.energy];
  const pain = { none: "无痛", mild: "轻微疼痛", moderate: "明显疼痛", severe: "严重疼痛" }[record.pain];
  const mood = { low: "情绪低落", calm: "情绪平静", sensitive: "较为敏感", irritable: "烦躁" }[record.mood];
  if (energy) labels.push(energy); if (pain) labels.push(pain); if (mood) labels.push(mood);
  record.painTypes?.forEach(id => { const item = PAIN_TYPES.find(type => type.id === id); if (item) labels.push(item.label); });
  record.symptoms?.forEach(id => { const item = SYMPTOMS.find(symptom => symptom.id === id); if (item) labels.push(item.label); });
  labels.push(...(record.customTags || []));
  if (record.note) labels.push("有备注");
  return labels;
}

function createTag(label, tone = tagTone(label)) {
  const span = document.createElement("span"); span.className = "record-tag"; span.dataset.tone = tone; span.textContent = label; return span;
}

function tagTone(label) {
  if (/经期|经量|出血/.test(label)) return "period";
  if (/同房|保护/.test(label)) return "intimacy";
  if (/情绪|低落|平静|敏感|烦躁/.test(label)) return "mood";
  if (/精力|疲倦|耗尽|充沛/.test(label)) return "energy";
  if (/痛|腹胀|痘痘|睡眠|食欲|分泌物/.test(label)) return "body";
  return "neutral";
}

function renderCalendar() {
  elements.monthTitle.textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(state.month);
  const prediction = calculatePrediction();
  elements.cycleSummary.textContent = prediction ? `预计开始 ${formatRange(prediction.startLower, prediction.startUpper)}` : "记录至少 2 次经期开始后显示预测";
  const first = startOfMonth(state.month);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  elements.calendarGrid.replaceChildren();
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index); const record = state.records[dateKey(date)];
    const button = document.createElement("button"); button.type = "button"; button.className = "day";
    button.setAttribute("role", "gridcell"); button.setAttribute("aria-label", dayAriaLabel(date, record));
    if (date.getMonth() !== state.month.getMonth()) button.classList.add("outside");
    if (isSameDay(date, new Date())) button.classList.add("today");
    if (record?.period && record.period !== "none") button.classList.add("period");
    if (record?.spotting) button.classList.add("spotting");
    if (isPredictedDate(date, prediction)) button.classList.add("predicted");
    if (!matchesCalendarFilter(record)) button.classList.add("filtered-out");
    button.innerHTML = `<span class="day-number">${date.getDate()}</span><span class="day-markers"></span>`;
    const markers = button.querySelector(".day-markers");
    if (record?.period && record.period !== "none") markers.append(makeMarker("period-marker"));
    if (hasIntimacyRecord(record)) markers.append(makeSexMarker(record));
    if (record?.spotting || record?.painTypes?.length || record?.symptoms?.length || record?.customTags?.length) markers.append(makeMarker("symptom-marker"));
    if (state.partnerResponses[dateKey(date)]) markers.append(makeMarker("response-marker"));
    button.addEventListener("click", () => openRecordForRole(date)); elements.calendarGrid.append(button);
  }
  renderMonthlyIntimacySummary();
}

function matchesCalendarFilter(record) {
  if (state.calendarFilter === "all") return true;
  if (state.calendarFilter === "period") return Boolean(record?.period && record.period !== "none");
  if (state.calendarFilter === "sex") return hasIntimacyRecord(record);
  return Boolean(record?.spotting || record?.painTypes?.length || record?.symptoms?.length || record?.customTags?.length);
}
function makeMarker(className) { const marker = document.createElement("i"); marker.className = `marker ${className}`; return marker; }
function hasIntimacyRecord(record) {
  return Boolean(record && (record.intimacyMode === "duration" ? record.sexMinutes > 0 : record.sexCount > 0));
}
function makeSexMarker(record) {
  const marker = document.createElement("span"); marker.className = "sex-count-marker";
  if (record.intimacyMode === "duration") {
    marker.classList.add("duration"); marker.textContent = record.sexMinutes >= 100 ? "时" : `${record.sexMinutes}m`;
    marker.title = `同房 ${record.sexMinutes} 分钟`;
  } else {
    marker.textContent = record.sexCount > 1 ? String(record.sexCount) : ""; marker.title = `同房 ${record.sexCount} 次`;
  }
  return marker;
}

function renderMonthlyIntimacySummary() {
  const year = state.month.getFullYear(), month = state.month.getMonth();
  const records = Object.entries(state.records).filter(([key, record]) => {
    const date = parseDate(key); return date.getFullYear() === year && date.getMonth() === month && hasIntimacyRecord(record);
  }).map(([, record]) => record);
  const total = records.filter(record => record.intimacyMode !== "duration").reduce((sum, record) => sum + record.sexCount, 0);
  const totalMinutes = records.filter(record => record.intimacyMode === "duration").reduce((sum, record) => sum + record.sexMinutes, 0);
  const protectedDays = records.filter(record => record.protection === "all").length;
  const unprotectedDays = records.filter(record => ["partial", "none"].includes(record.protection)).length;
  const unknownDays = records.filter(record => record.protection === "unknown").length;
  elements.intimacyMonthLabel.textContent = `${year}年${month + 1}月`;
  elements.monthlySexTotal.textContent = String(total); elements.monthlySexMinutes.textContent = String(totalMinutes);
  elements.monthlySexDays.textContent = String(records.length);
  elements.monthlyUnprotectedDays.textContent = String(unprotectedDays);
  if (!records.length) elements.monthlyProtectionCopy.textContent = "这个月还没有亲密记录。";
  else elements.monthlyProtectionCopy.textContent = `全部有保护 ${protectedDays} 天${unknownDays ? ` · 未记录保护措施 ${unknownDays} 天` : ""}`;
}
function dayAriaLabel(date, record) {
  return [new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date), ...recordLabels(record)].join("，");
}

function openMonthPicker() {
  const currentYear = new Date().getFullYear();
  const recordYears = Object.keys(state.records).map(key => parseDate(key).getFullYear());
  const minimumYear = Math.min(currentYear - 10, ...recordYears);
  const maximumYear = Math.max(currentYear + 2, ...recordYears);
  elements.intimacyYearSelect.replaceChildren(); elements.intimacyMonthSelect.replaceChildren();
  for (let year = maximumYear; year >= minimumYear; year -= 1) {
    const option = document.createElement("option"); option.value = String(year); option.textContent = `${year} 年`;
    elements.intimacyYearSelect.append(option);
  }
  for (let month = 1; month <= 12; month += 1) {
    const option = document.createElement("option"); option.value = String(month); option.textContent = `${month} 月`;
    elements.intimacyMonthSelect.append(option);
  }
  elements.intimacyYearSelect.value = String(state.month.getFullYear());
  elements.intimacyMonthSelect.value = String(state.month.getMonth() + 1);
  elements.monthPickerDialog.showModal();
}

function applyIntimacyMonth() {
  const year = Number(elements.intimacyYearSelect.value); const month = Number(elements.intimacyMonthSelect.value);
  if (!Number.isInteger(year) || month < 1 || month > 12) return;
  state.month = new Date(year, month - 1, 1, 12); elements.monthPickerDialog.close(); renderCalendar();
}

function openRecordForRole(date) {
  if (state.cloudRole === "partner") openRecordDetail(date);
  else openRecordDialog(date);
}

function openRecordDetail(date) {
  const key = dateKey(date);
  const record = state.records[key];
  state.detailDate = key;
  elements.recordDetailTitle.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short"
  }).format(date);
  elements.recordDetailBody.replaceChildren();
  if (!record || !recordHasData(record)) {
    const empty = document.createElement("p"); empty.className = "record-detail-empty"; empty.textContent = "这一天没有记录";
    elements.recordDetailBody.append(empty);
  } else {
    const groups = recordDetailGroups(record);
    groups.filter(group => group.values.length).forEach(group => {
      const section = document.createElement("section"); section.className = "record-detail-section"; section.dataset.tone = group.tone;
      const heading = document.createElement("h3");
      const icon = document.createElement("i"); icon.dataset.lucide = group.icon;
      const title = document.createElement("span"); title.textContent = group.title;
      heading.append(icon, title);
      const values = document.createElement("div"); values.className = "record-detail-values";
      group.values.forEach(value => values.append(createTag(value, group.tone))); section.append(heading, values);
      elements.recordDetailBody.append(section);
    });
    if (record.note) {
      const section = document.createElement("section"); section.className = "record-detail-section note";
      const heading = document.createElement("h3"); heading.textContent = "备注";
      const note = document.createElement("p"); note.textContent = record.note; section.append(heading, note);
      elements.recordDetailBody.append(section);
    }
  }
  renderPartnerResponsePanel(key, record);
  elements.recordDetailDialog.showModal(); queueMicrotask(refreshIcons);
}

function recordDetailGroups(record) {
  const cycle = [];
  const period = { start: "经期开始", ongoing: "经期进行中", end: "经期结束" }[record.period];
  const flow = { light: "经量少", medium: "经量中", heavy: "经量多", veryHeavy: "经量超多" }[record.flow];
  if (period) cycle.push(period); if (flow) cycle.push(flow); if (record.spotting) cycle.push("点滴出血");
  const body = [];
  const energy = { exhausted: "精力耗尽", low: "有些疲倦", normal: "精力正常", high: "精力充沛" }[record.energy];
  const pain = { none: "无痛", mild: "轻微疼痛", moderate: "明显疼痛", severe: "严重疼痛" }[record.pain];
  const mood = { low: "情绪低落", calm: "情绪平静", sensitive: "较为敏感", irritable: "烦躁" }[record.mood];
  if (energy) body.push(energy); if (pain) body.push(pain); if (mood) body.push(mood);
  record.painTypes?.forEach(id => { const item = PAIN_TYPES.find(type => type.id === id); if (item) body.push(item.label); });
  record.symptoms?.forEach(id => { const item = SYMPTOMS.find(symptom => symptom.id === id); if (item) body.push(item.label); });
  const intimacy = [];
  if (hasIntimacyRecord(record)) {
    intimacy.push(record.intimacyMode === "duration" ? `总时长 ${record.sexMinutes} 分钟` : `${record.sexCount} 次`);
    intimacy.push(`保护措施：${{ all: "全部有", partial: "部分有", none: "均无", unknown: "未记录" }[record.protection] || "未记录"}`);
  }
  return [
    { title: "经期", icon: "droplets", tone: "period", values: cycle },
    { title: "身体与情绪", icon: "heart-pulse", tone: "body", values: body },
    { title: "亲密记录", icon: "heart", tone: "intimacy", values: intimacy },
    { title: "自定义标签", icon: "tags", tone: "neutral", values: record.customTags || [] }
  ];
}

function partnerResponseOption(type) {
  if (type === "custom") return { id: "custom", label: "", icon: "message-square-heart" };
  return PARTNER_RESPONSES.find(option => option.id === type);
}

function renderTodayResponse() {
  const todayKey = dateKey(new Date());
  const latestKey = state.partnerResponses[todayKey] ? todayKey : Object.keys(state.partnerResponses)
    .sort((a, b) => String(state.partnerResponses[b]?.updatedAt || b).localeCompare(String(state.partnerResponses[a]?.updatedAt || a)))[0];
  renderResponseBanner(elements.todayPartnerResponse, latestKey, { showDate: latestKey !== todayKey, openRecord: true });
}

function renderResponseBanner(container, key, options = {}) {
  if (!container) return;
  const response = state.partnerResponses[key];
  const option = partnerResponseOption(response?.type);
  container.replaceChildren();
  container.hidden = !option;
  if (!option) return;
  const icon = document.createElement("span"); icon.className = "partner-response-badge";
  const glyph = document.createElement("i"); glyph.dataset.lucide = option.icon; icon.append(glyph);
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const responseLabel = response.type === "custom" ? response.text : option.label;
  title.textContent = state.cloudRole === "partner" ? `你回应了：${responseLabel}` : `伴侣回应：${responseLabel}`;
  const time = document.createElement("small");
  const dateLabel = options.showDate ? `${formatShortDate(parseDate(key))} · ` : "";
  time.textContent = `${dateLabel}${response.updatedAt ? `更新于 ${formatResponseTime(response.updatedAt)}` : "已同步到伴侣空间"}`;
  copy.append(title, time); container.append(icon, copy); queueMicrotask(refreshIcons);
  container.classList.toggle("clickable", Boolean(options.openRecord && key && state.records[key]));
  container.onclick = options.openRecord && key && state.records[key] ? () => openRecordForRole(parseDate(key)) : null;
}

function formatShortDate(date) { return `${date.getMonth() + 1}月${date.getDate()}日`; }

function formatResponseTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function renderPartnerResponsePanel(key, record) {
  const visible = state.cloudRole === "partner" && record && recordHasData(record) && state.responsesPaired;
  elements.partnerResponsePanel.hidden = !visible;
  elements.partnerResponseOptions.replaceChildren();
  if (!visible) return;
  const enabled = state.responsesAvailable && state.responsesEnabled;
  elements.partnerResponseHint.textContent = !state.responsesAvailable
    ? "云端功能尚未升级"
    : state.responsesEnabled ? "轻点发送，再点一次即可撤回" : "记录者暂未开启伴侣回应";
  PARTNER_RESPONSES.forEach(option => {
    const button = document.createElement("button"); button.type = "button"; button.className = "partner-response-option";
    button.disabled = !enabled; button.classList.toggle("selected", state.partnerResponses[key]?.type === option.id);
    const icon = document.createElement("i"); icon.dataset.lucide = option.icon;
    const label = document.createElement("span"); label.textContent = option.label;
    button.append(icon, label);
    button.addEventListener("click", () => sendPartnerResponse(key, option.id, button));
    elements.partnerResponseOptions.append(button);
  });
  const current = state.partnerResponses[key];
  elements.customResponse.value = current?.type === "custom" ? current.text || "" : "";
  elements.customResponse.disabled = !enabled;
  elements.sendCustomResponse.disabled = !enabled;
  queueMicrotask(refreshIcons);
}

async function sendPartnerResponse(key, type, sourceButton) {
  const selected = state.partnerResponses[key]?.type === type;
  elements.partnerResponseOptions.querySelectorAll("button").forEach(button => { button.disabled = true; });
  sourceButton.classList.add("pending");
  const success = await window.CloudSync?.setPartnerResponse(key, selected ? null : type, null);
  if (!success) {
    showToast("回应未发送，请检查网络后重试");
    renderPartnerResponsePanel(key, state.records[key]);
    return;
  }
  showToast(selected ? "回应已撤回" : "回应已发送");
}

async function sendCustomPartnerResponse() {
  const key = state.detailDate;
  const text = elements.customResponse.value.trim();
  if (!key || !text) { showToast("先写一句想说的话"); return; }
  elements.partnerResponseOptions.querySelectorAll("button").forEach(button => { button.disabled = true; });
  elements.customResponse.disabled = true; elements.sendCustomResponse.disabled = true;
  const success = await window.CloudSync?.setPartnerResponse(key, "custom", text);
  if (!success) { showToast("回应未发送，请检查网络后重试"); renderPartnerResponsePanel(key, state.records[key]); return; }
  showToast("回应已发送");
}

function showReleaseNotes() {
  if (localStorage.getItem(RELEASE_NOTES_KEY) || elements.releaseDialog.open) return;
  if (document.querySelector("dialog[open]")) { window.setTimeout(showReleaseNotes, 1000); return; }
  elements.releaseDialog.showModal(); queueMicrotask(refreshIcons);
}

function closeReleaseNotes() {
  localStorage.setItem(RELEASE_NOTES_KEY, "seen"); elements.releaseDialog.close();
}

function renderSymptomOptions() {
  elements.symptomOptions.replaceChildren();
  SYMPTOMS.forEach(symptom => {
    const label = document.createElement("label"); label.className = "choice-chip";
    label.innerHTML = `<input type="checkbox" name="symptoms" value="${symptom.id}"><span>${symptom.label}</span>`;
    elements.symptomOptions.append(label);
  });
}

function renderPainTypeOptions() {
  elements.painTypeOptions.replaceChildren();
  PAIN_TYPES.forEach(type => {
    const label = document.createElement("label"); label.className = "pain-location-option";
    label.innerHTML = `<input type="checkbox" name="painTypes" value="${type.id}"><span><i data-lucide="${type.icon}"></i>${type.label}</span>`;
    label.querySelector("input").addEventListener("change", event => {
      if (event.target.checked && selectedRadio("pain") === "none") setOptionalRadio("pain", null);
    });
    elements.painTypeOptions.append(label);
  });
}

function openRecordDialog(date) {
  if (state.cloudRole === "partner") { openRecordDetail(date); return; }
  populateRecordForm(date);
  if (!elements.recordDialog.open) elements.recordDialog.showModal();
  queueMicrotask(refreshIcons);
}

function populateRecordForm(date) {
  state.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const key = dateKey(state.selectedDate);
  const draft = loadRecordDraft(key);
  const record = draft || state.records[key] || normalizeRecord();
  elements.recordDateTitle.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short"
  }).format(state.selectedDate);
  setRadio("period", record.period || "none"); setRadio("flow", record.flow || "medium");
  setOptionalRadio("energy", record.energy); setOptionalRadio("pain", record.pain); setOptionalRadio("mood", record.mood);
  document.querySelectorAll('input[name="painTypes"]').forEach(input => { input.checked = record.painTypes.includes(input.value); });
  elements.spotting.checked = Boolean(record.spotting);
  state.intimacyMode = record.intimacyMode || "count"; state.sexCount = record.sexCount || 0; state.sexMinutes = record.sexMinutes || 0;
  setRadio("intimacyMode", state.intimacyMode); renderIntimacyAmount();
  setRadio("protection", record.protection || "unknown");
  document.querySelectorAll('input[name="symptoms"]').forEach(input => { input.checked = record.symptoms.includes(input.value); });
  elements.customTags.value = record.customTags.join("、"); elements.note.value = record.note || "";
  elements.deleteRecord.hidden = !state.records[dateKey(state.selectedDate)];
  renderResponseBanner(elements.recordFormResponse, key);
  elements.editPeriodRange.hidden = !(record.period && record.period !== "none");
  renderRecordWeekStrip(); updateFormVisibility();
  if (draft) showToast("已恢复这一天的未保存内容");
}

function setRadio(name, value) { const input = document.querySelector(`input[name="${name}"][value="${value}"]`); if (input) input.checked = true; }
function setOptionalRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(input => { input.checked = input.value === value; });
}
function selectedRadio(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
function changeIntimacyMode() {
  state.intimacyMode = selectedRadio("intimacyMode") === "duration" ? "duration" : "count";
  renderIntimacyAmount(); updateFormVisibility(); saveRecordDraft();
}
function changeSexCount(direction) {
  const step = state.intimacyMode === "duration" ? 5 : 1;
  if (state.intimacyMode === "duration") state.sexMinutes = clamp(state.sexMinutes + direction * step, 0, 600);
  else state.sexCount = clamp(state.sexCount + direction * step, 0, 9);
  renderIntimacyAmount(); updateFormVisibility(); saveRecordDraft();
}
function updateIntimacyAmountFromInput() {
  const value = Number(elements.sexAmountInput.value);
  if (state.intimacyMode === "duration") state.sexMinutes = clamp(Number.isFinite(value) ? Math.round(value) : 0, 0, 600);
  else state.sexCount = clamp(Number.isFinite(value) ? Math.round(value) : 0, 0, 9);
  renderIntimacyAmount(); updateFormVisibility(); saveRecordDraft();
}
function renderIntimacyAmount() {
  const duration = state.intimacyMode === "duration"; const value = duration ? state.sexMinutes : state.sexCount;
  const maximum = duration ? 600 : 9;
  elements.intimacyAmountLabel.textContent = duration ? "当天总时长" : "当天次数";
  elements.intimacyAmountHint.textContent = duration ? "单位：分钟，最多 600 分钟" : "最多记录 9 次";
  elements.intimacyAmountStepper.setAttribute("aria-label", duration ? "当天同房总时长" : "当天同房次数");
  elements.sexAmountInput.min = "0"; elements.sexAmountInput.max = String(maximum); elements.sexAmountInput.step = duration ? "5" : "1";
  elements.sexAmountInput.setAttribute("aria-label", duration ? "当天同房总分钟" : "当天同房次数");
  elements.sexAmountInput.value = String(value);
  document.querySelector("#decreaseSexCount").disabled = value === 0;
  document.querySelector("#increaseSexCount").disabled = value === maximum;
}
function syncPainSelection() {
  if (selectedRadio("pain") === "none") document.querySelectorAll('input[name="painTypes"]').forEach(input => { input.checked = false; });
}
function renderRecordWeekStrip() {
  elements.recordWeekStrip.replaceChildren();
  for (let offset = -3; offset <= 3; offset += 1) {
    const date = addDays(state.selectedDate, offset); const key = dateKey(date);
    const button = document.createElement("button"); button.type = "button"; button.className = "record-week-day";
    button.classList.toggle("selected", offset === 0); button.classList.toggle("has-data", Boolean(state.records[key]));
    button.setAttribute("aria-label", formatLongDate(date));
    button.innerHTML = `<span>${new Intl.DateTimeFormat("zh-CN", { weekday: "narrow" }).format(date)}</span><strong>${date.getDate()}</strong><i></i>`;
    button.addEventListener("click", () => populateRecordForm(date)); elements.recordWeekStrip.append(button);
  }
}
function updateFormVisibility() {
  elements.flowFieldset.hidden = selectedRadio("period") === "none";
  elements.protectionRow.hidden = state.intimacyMode === "duration" ? state.sexMinutes === 0 : state.sexCount === 0;
}

function collectRecordForm() {
  const period = selectedRadio("period");
  return normalizeRecord({
    period, flow: period === "none" ? null : selectedRadio("flow"), spotting: elements.spotting.checked,
    energy: selectedRadio("energy"), pain: selectedRadio("pain"), mood: selectedRadio("mood"),
    painTypes: selectedRadio("pain") === "none" ? [] : [...document.querySelectorAll('input[name="painTypes"]:checked')].map(input => input.value),
    intimacyMode: state.intimacyMode, sexCount: state.sexCount, sexMinutes: state.sexMinutes,
    hadSex: state.intimacyMode === "duration" ? state.sexMinutes > 0 : state.sexCount > 0,
    protection: (state.intimacyMode === "duration" ? state.sexMinutes : state.sexCount) ? selectedRadio("protection") : null,
    symptoms: [...document.querySelectorAll('input[name="symptoms"]:checked')].map(input => input.value),
    customTags: parseTags(elements.customTags.value), note: elements.note.value.trim()
  });
}

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(storageKey(DRAFT_KEY))) || {}; }
  catch { return {}; }
}

function loadRecordDraft(key) { return loadDrafts()[key] ? normalizeRecord(loadDrafts()[key]) : null; }

function saveRecordDraft() {
  if (!state.selectedDate || !elements.recordDialog.open) return;
  const drafts = loadDrafts(); drafts[dateKey(state.selectedDate)] = collectRecordForm();
  localStorage.setItem(storageKey(DRAFT_KEY), JSON.stringify(drafts));
}

function clearRecordDraft(key) {
  const drafts = loadDrafts(); delete drafts[key]; localStorage.setItem(storageKey(DRAFT_KEY), JSON.stringify(drafts));
}

function saveCurrentRecord() {
  const key = dateKey(state.selectedDate); const record = collectRecordForm();
  if (recordHasData(record)) state.records[key] = record; else delete state.records[key];
  clearRecordDraft(key); persist(); elements.recordDialog.close(); render(); showToast("已保存");
}
function parseTags(value) { return [...new Set(value.split(/[，,、]/).map(item => item.trim()).filter(Boolean))].slice(0, 8); }
function recordHasData(record) {
  return Boolean((record.period && record.period !== "none") || record.spotting || record.energy || record.pain || record.mood || record.painTypes?.length || hasIntimacyRecord(record) || record.symptoms?.length || record.customTags?.length || record.note);
}
function deleteCurrentRecord() {
  const key = dateKey(state.selectedDate); delete state.records[key]; clearRecordDraft(key); persist(); elements.recordDialog.close(); render(); showToast("记录已删除");
}

function editSelectedPeriodRange() {
  const segment = findPeriodSegment(state.selectedDate); if (!segment) return;
  elements.recordDialog.close(); openPeriodRangeDialog(segment.start, segment.end);
}
function findPeriodSegment(date) {
  const record = state.records[dateKey(date)]; if (!record?.period || record.period === "none") return null;
  let start = new Date(date); let end = new Date(date);
  for (let count = 0; count < 20; count += 1) {
    const previous = addDays(start, -1); const item = state.records[dateKey(previous)];
    if (!item?.period || item.period === "none") break; start = previous;
  }
  for (let count = 0; count < 20; count += 1) {
    const next = addDays(end, 1); const item = state.records[dateKey(next)];
    if (!item?.period || item.period === "none") break; end = next;
  }
  return { start, end };
}
function openPeriodRangeDialog(start, end = addDays(start, 4)) {
  if (state.cloudRole === "partner") { showToast("伴侣账号只能查看记录"); return; }
  const existing = findPeriodSegment(start); state.periodRangeOriginal = existing;
  elements.periodStart.value = dateKey(existing?.start || start); elements.periodEnd.value = dateKey(existing?.end || end);
  document.querySelector("#periodRangeTitle").textContent = existing ? "编辑整段经期" : "记录一段经期";
  elements.deletePeriodRange.hidden = !existing;
  setRadio("rangeFlow", state.records[dateKey(existing?.start || start)]?.flow || "medium");
  elements.periodRangeDialog.showModal();
}
function savePeriodRange() {
  const start = parseDate(elements.periodStart.value); const end = parseDate(elements.periodEnd.value);
  const duration = daysBetween(start, end) + 1;
  if (!elements.periodStart.value || !elements.periodEnd.value || duration < 1 || duration > 20) {
    showToast("请选择 1 至 20 天的有效区间"); return;
  }
  if (state.periodRangeOriginal) clearPeriodFields(state.periodRangeOriginal.start, state.periodRangeOriginal.end);
  const flow = selectedRadio("rangeFlow") || "medium";
  for (let offset = 0; offset < duration; offset += 1) {
    const date = addDays(start, offset); const key = dateKey(date); const existing = state.records[key] || normalizeRecord();
    existing.period = duration === 1 || offset === 0 ? "start" : offset === duration - 1 ? "end" : "ongoing";
    existing.flow = flow; state.records[key] = existing;
  }
  persist(); state.month = startOfMonth(start); elements.periodRangeDialog.close(); render(); showToast(`已记录 ${duration} 天经期`);
}
function clearPeriodFields(start, end) {
  for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
    const key = dateKey(date); const record = state.records[key]; if (!record) continue;
    record.period = "none"; record.flow = null; if (!recordHasData(record)) delete state.records[key];
  }
}
function deleteCurrentPeriodRange() {
  if (!state.periodRangeOriginal) return;
  clearPeriodFields(state.periodRangeOriginal.start, state.periodRangeOriginal.end);
  persist(); elements.periodRangeDialog.close(); render(); showToast("整段经期已删除");
}

function periodStarts() {
  return Object.entries(state.records).filter(([, record]) => record.period === "start").map(([key]) => parseDate(key)).sort((a, b) => a - b);
}
function cycleIntervals() {
  const starts = periodStarts();
  return starts.slice(1).map((date, index) => ({ date, days: daysBetween(starts[index], date) })).filter(item => item.days >= 15 && item.days <= 60);
}
function calculatePrediction() {
  const starts = periodStarts(); const intervals = cycleIntervals().slice(-6).map(item => item.days);
  if (starts.length < 2 || !intervals.length) return null;
  const cycleLength = median(intervals); const deviation = standardDeviation(intervals);
  const variation = intervals.length === 1 ? 3 : clamp(Math.ceil(deviation), 2, 7);
  const latest = starts.at(-1); const lengths = periodLengths();
  const periodLength = lengths.length ? Math.round(average(lengths.slice(-6))) : 5;
  let confidence = "low"; let confidenceLabel = "初步估算";
  if (intervals.length >= 4 && deviation <= 3) { confidence = "high"; confidenceLabel = "较稳定"; }
  else if (intervals.length >= 2 && deviation <= 6) { confidence = "medium"; confidenceLabel = "可供参考"; }
  else if (intervals.length >= 2) confidenceLabel = "波动较大";
  const start = addDays(latest, cycleLength);
  return { start, startLower: addDays(start, -variation), startUpper: addDays(start, variation), cycleLength, periodLength, variation, deviation, confidence, confidenceLabel };
}
function periodLengths() {
  return periodStarts().map(start => {
    let count = 0;
    for (let offset = 0; offset < 20; offset += 1) {
      const record = state.records[dateKey(addDays(start, offset))];
      if (record?.period && record.period !== "none") count += 1; else if (offset > 0) break;
    }
    return count;
  }).filter(Boolean);
}
function isPredictedDate(date, prediction) {
  if (!prediction) return false;
  const end = addDays(prediction.startUpper, prediction.periodLength - 1);
  return startOfDay(date) >= startOfDay(prediction.startLower) && startOfDay(date) <= startOfDay(end);
}

function renderInsights() {
  const prediction = calculatePrediction(); const starts = periodStarts(); const lengths = periodLengths(); const intervals = cycleIntervals();
  const values = [
    [intervals.length ? `${Math.round(average(intervals.slice(-6).map(item => item.days)))} 天` : "--", "平均周期"],
    [lengths.length ? `${Math.round(average(lengths.slice(-6)))} 天` : "--", "平均经期"],
    [prediction ? formatRange(prediction.startLower, prediction.startUpper) : "--", "预计开始范围"],
    [prediction?.confidenceLabel || "数据不足", "预测可信度"]
  ];
  elements.metrics.innerHTML = values.map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
  renderRegularity(intervals.slice(-6)); renderCycleChart(intervals.slice(-6)); renderSymptomSummary();
  renderChangeSummary(intervals.slice(-6), lengths.slice(-6)); renderFlowHistory(starts.slice(-6));
  const recentStarts = starts.slice(-8).reverse();
  if (!recentStarts.length) { elements.historyList.innerHTML = '<div class="empty-state">尚无经期开始记录</div>'; return; }
  elements.historyList.innerHTML = recentStarts.map((date, index) => {
    const previous = recentStarts[index + 1]; const cycle = previous ? `${daysBetween(previous, date)} 天周期` : "首次记录";
    return `<div class="history-row"><div><strong>${formatLongDate(date)}</strong><span>经期开始</span></div><span>${cycle}</span></div>`;
  }).join("");
}

function renderRegularity(items) {
  const values = items.map(item => item.days); const circumference = 2 * Math.PI * 31;
  if (values.length < 2) {
    elements.regularityArc.style.strokeDasharray = `0 ${circumference}`; elements.regularityValue.textContent = "--";
    elements.regularityValue.dataset.empty = "true";
    elements.analysisVerdict.textContent = "等待更多记录"; elements.analysisCopy.textContent = "至少记录三个周期后生成个人变化结论。"; return;
  }
  const deviation = standardDeviation(values); const score = clamp(Math.round(100 - deviation * 10), 0, 100);
  const range = Math.max(...values) - Math.min(...values);
  elements.regularityArc.style.strokeDasharray = `${circumference * score / 100} ${circumference}`;
  elements.regularityValue.textContent = `${score}`; elements.regularityValue.dataset.empty = "false";
  elements.analysisVerdict.textContent = score >= 80 ? "整体较稳定" : score >= 60 ? "有一些波动" : "近期波动明显";
  elements.analysisCopy.textContent = `最近周期在 ${Math.min(...values)}–${Math.max(...values)} 天之间，相差 ${range} 天。`;
}

function renderChangeSummary(intervals, lengths) {
  const changes = [];
  const intervalValues = intervals.map(item => item.days);
  if (intervalValues.length >= 4) {
    const windowSize = Math.min(3, Math.floor(intervalValues.length / 2));
    const previous = intervalValues.slice(-windowSize * 2, -windowSize); const recent = intervalValues.slice(-windowSize);
    const previousAverage = Math.round(average(previous)); const recentAverage = Math.round(average(recent));
    const averageDifference = recentAverage - previousAverage;
    const previousVariation = Math.max(...previous) - Math.min(...previous); const recentVariation = Math.max(...recent) - Math.min(...recent);
    const variationDifference = recentVariation - previousVariation;
    changes.push({
      icon: averageDifference === 0 ? "circle-check" : averageDifference > 0 ? "trending-up" : "trending-down",
      tone: Math.abs(averageDifference) >= 3 ? "attention" : "stable",
      title: averageDifference === 0 ? "平均周期没有明显变化" : `平均周期${averageDifference > 0 ? "变长" : "变短"} ${Math.abs(averageDifference)} 天`,
      copy: `从此前约 ${previousAverage} 天变为近期约 ${recentAverage} 天。`
    });
    changes.push({
      icon: variationDifference <= 0 ? "badge-check" : "triangle-alert", tone: recentVariation >= 8 ? "attention" : "stable",
      title: variationDifference === 0 ? "周期波动保持不变" : `周期波动${variationDifference > 0 ? "增加" : "减少"} ${Math.abs(variationDifference)} 天`,
      copy: `周期长度范围从相差 ${previousVariation} 天变为相差 ${recentVariation} 天。`
    });
  } else if (intervalValues.length >= 3) {
    const latest = intervalValues.at(-1); const baseline = average(intervalValues.slice(0, -1)); const difference = Math.round(latest - baseline);
    changes.push({ icon: difference === 0 ? "circle-check" : difference > 0 ? "trending-up" : "trending-down", tone: Math.abs(difference) >= 3 ? "attention" : "stable", title: `最近周期${difference === 0 ? "接近往常" : difference > 0 ? `长了约 ${difference} 天` : `短了约 ${Math.abs(difference)} 天`}`, copy: `本次 ${latest} 天，此前平均约 ${Math.round(baseline)} 天。` });
  }
  if (lengths.length >= 3) {
    const latest = lengths.at(-1); const baseline = average(lengths.slice(0, -1)); const difference = Math.round(latest - baseline);
    changes.push({ icon: "droplets", tone: Math.abs(difference) >= 2 ? "attention" : "stable", title: `最近经期持续 ${latest} 天`, copy: Math.abs(difference) < 1 ? "与此前记录接近。" : `比此前平均${difference > 0 ? "多" : "少"}约 ${Math.abs(difference)} 天。` });
  }
  if (!changes.length) { elements.changeSummary.innerHTML = '<div class="empty-state">记录至少三个周期后比较变化</div>'; return; }
  elements.changeSummary.innerHTML = changes.map(item => `<div class="change-item ${item.tone || "stable"}"><span class="change-icon"><i data-lucide="${item.icon}"></i></span><div><strong>${item.title}</strong><span>${item.copy}</span></div></div>`).join("");
}

function renderFlowHistory(starts) {
  if (!starts.length) { elements.flowHistory.innerHTML = '<div class="empty-state">记录经期流量后显示历史</div>'; return; }
  const rows = starts.slice().reverse().map(start => {
    const cells = Array.from({ length: 7 }, (_, offset) => {
      const record = state.records[dateKey(addDays(start, offset))]; const level = ["light", "medium", "heavy", "veryHeavy"].includes(record?.flow) ? record.flow : "empty";
      return `<i class="flow-cell ${level}" title="第 ${offset + 1} 天"></i>`;
    }).join("");
    return `<div class="flow-row"><span>${formatShortDate(start)}</span><div class="flow-cells">${cells}</div></div>`;
  }).join("");
  elements.flowHistory.innerHTML = `${rows}<div class="flow-legend"><span><i class="light"></i>少</span><span><i class="medium"></i>中</span><span><i class="heavy"></i>多</span><span><i class="veryHeavy"></i>超多</span></div>`;
}

function renderCycleChart(items) {
  if (!items.length) { elements.cycleChart.innerHTML = '<div class="empty-state">再记录一次经期后显示趋势</div>'; return; }
  const width = 600, height = 180, left = 38, right = 22, top = 24, bottom = 34;
  const values = items.map(item => item.days); const min = Math.max(10, Math.min(...values) - 4); const max = Math.max(min + 8, Math.max(...values) + 4);
  const points = items.map((item, index) => {
    const x = items.length === 1 ? width / 2 : left + index * ((width - left - right) / (items.length - 1));
    const y = top + (max - item.days) * ((height - top - bottom) / (max - min)); return { ...item, x, y };
  });
  const line = points.map(point => `${point.x},${point.y}`).join(" ");
  const pointMarkup = points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="6"></circle><text class="chart-value" x="${point.x}" y="${point.y - 13}">${point.days}</text><text class="chart-date" x="${point.x}" y="${height - 9}">${point.date.getMonth() + 1}/${point.date.getDate()}</text>`).join("");
  elements.cycleChart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="最近周期长度趋势图"><line class="chart-gridline" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line><polyline points="${line}"></polyline>${pointMarkup}</svg>`;
}

function renderSymptomSummary() {
  const counts = new Map();
  Object.values(state.records).forEach(record => {
    [...(record.painTypes || []), ...(record.symptoms || [])].forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
  });
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!ranked.length) { elements.symptomSummary.innerHTML = '<div class="empty-state">记录症状后显示出现频率</div>'; return; }
  const max = ranked[0][1]; elements.symptomSummary.replaceChildren();
  ranked.forEach(([id, count]) => {
    const row = document.createElement("div"); row.className = "symptom-bar-row";
    const label = [...PAIN_TYPES, ...SYMPTOMS].find(item => item.id === id)?.label || id;
    row.innerHTML = `<span>${label}</span><i><b style="width:${Math.round(count / max * 100)}%"></b></i><strong>${count} 次</strong>`;
    elements.symptomSummary.append(row);
  });
}

function renderBackupStatus() {
  elements.backupStatus.textContent = state.settings.lastBackupAt ? `上次备份：${formatLongDate(new Date(state.settings.lastBackupAt))}` : "尚未备份，使用密码保护 JSON 文件";
}
function openBackupDialog(mode) {
  state.backupMode = mode; elements.backupPassword.value = ""; elements.backupPasswordConfirm.value = ""; elements.backupError.textContent = "";
  const importing = mode === "import";
  document.querySelector("#backupDialogTitle").textContent = importing ? "解锁加密备份" : "创建加密备份";
  document.querySelector("#backupDialogText").textContent = importing ? "输入创建备份时使用的密码。" : "设置至少 8 位备份密码。忘记密码将无法恢复文件。";
  document.querySelector("#confirmPasswordField").hidden = importing;
  document.querySelector("#confirmBackupAction").textContent = importing ? "恢复" : "导出";
  elements.backupDialog.showModal(); elements.backupPassword.focus();
}
async function runBackupAction() {
  elements.backupError.textContent = ""; const password = elements.backupPassword.value;
  if (password.length < 8) { elements.backupError.textContent = "密码至少需要 8 位。"; return; }
  if (state.backupMode === "export" && password !== elements.backupPasswordConfirm.value) { elements.backupError.textContent = "两次输入的密码不一致。"; return; }
  const button = document.querySelector("#confirmBackupAction"); button.disabled = true;
  try {
    if (state.backupMode === "export") await exportEncryptedData(password); else await restoreEncryptedData(password);
    elements.backupDialog.close();
  } catch {
    elements.backupError.textContent = state.backupMode === "import" ? "密码不正确或备份文件已损坏。" : "无法创建备份，请稍后重试。";
  } finally { button.disabled = false; }
}
async function exportEncryptedData(password) {
  const exportedAt = new Date().toISOString();
  const backupSettings = { ...state.settings, lastBackupAt: exportedAt };
  const payload = JSON.stringify({ version: 2, exportedAt, records: state.records, settings: backupSettings });
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(password, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload));
  const envelope = { format: "cycle-journal-encrypted", version: 2, encryption: {
    algorithm: "AES-GCM", kdf: "PBKDF2-SHA-256", iterations: BACKUP_ITERATIONS,
    salt: bytesToBase64(salt), iv: bytesToBase64(iv)
  }, ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
  downloadJson(envelope, `周期记加密备份-${dateKey(new Date())}.json`);
  state.settings.lastBackupAt = exportedAt; persist(); render(); showToast("加密备份已导出");
}
async function importData(event) {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.format === "cycle-journal-encrypted") { state.pendingImport = parsed; openBackupDialog("import"); }
    else { restorePayload(parsed); showToast("备份已恢复"); }
  } catch { showToast("无法读取这个备份文件"); }
  finally { event.target.value = ""; }
}
async function restoreEncryptedData(password) {
  const envelope = state.pendingImport; if (!envelope?.encryption || !envelope.ciphertext) throw new Error("invalid");
  if (envelope.version !== 2 || envelope.encryption.algorithm !== "AES-GCM" ||
      envelope.encryption.kdf !== "PBKDF2-SHA-256" || envelope.encryption.iterations !== BACKUP_ITERATIONS) {
    throw new Error("unsupported");
  }
  const salt = base64ToBytes(envelope.encryption.salt); const iv = base64ToBytes(envelope.encryption.iv);
  const key = await deriveBackupKey(password, salt, ["decrypt"], envelope.encryption.iterations);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(envelope.ciphertext));
  restorePayload(JSON.parse(new TextDecoder().decode(plaintext))); state.pendingImport = null; showToast("加密备份已恢复");
}
function restorePayload(payload) {
  if (![1, 2].includes(payload.version) || !payload.records || typeof payload.records !== "object") throw new Error("invalid");
  state.records = Object.fromEntries(Object.entries(payload.records).map(([key, record]) => [key, normalizeRecord(record)]));
  state.settings = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) }; persist(); render();
}
async function deriveBackupKey(password, salt, usages, iterations = BACKUP_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, usages);
}
function bytesToBase64(bytes) { let binary = ""; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0)); }
function downloadJson(value, filename) {
  downloadText(JSON.stringify(value, null, 2), filename, "application/json");
}
function downloadText(value, filename, type) {
  const blob = new Blob([value], { type }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderReminderSettings() {
  const enabled = Boolean(state.settings.reminderEnabled);
  elements.reminderEnabled.checked = enabled; elements.reminderControls.hidden = !enabled;
  elements.reminderDays.value = String(clamp(Number(state.settings.reminderDays) || 0, 0, 3));
  elements.reminderTime.value = /^\d{2}:\d{2}$/.test(state.settings.reminderTime) ? state.settings.reminderTime : "09:00";
  if (!enabled) elements.reminderStatus.textContent = "尚未开启";
  else if (!("Notification" in window)) elements.reminderStatus.textContent = "浏览器不支持通知，可使用系统日历";
  else if (Notification.permission === "denied") elements.reminderStatus.textContent = "通知已被浏览器阻止，可使用系统日历";
  else elements.reminderStatus.textContent = `${reminderLeadLabel()}，${elements.reminderTime.value}`;
}

function renderPartnerSettings() {
  elements.partnerName.value = state.settings.partnerName || "";
  elements.partnerMessage.value = state.settings.partnerMessage || "";
  elements.shareCycle.checked = state.settings.partnerShareCycle !== false;
  elements.shareBody.checked = state.settings.partnerShareBody !== false;
  elements.shareMood.checked = state.settings.partnerShareMood !== false;
}

function renderResponseSettings() {
  if (!elements.responseSettings) return;
  elements.responseSettings.hidden = !state.responsesPaired;
  if (!state.responsesPaired) return;
  elements.responsesEnabled.checked = state.responsesEnabled;
  elements.responsesEnabled.disabled = state.cloudRole !== "owner" || !state.responsesAvailable;
  if (!state.responsesAvailable) elements.responseSettingsHint.textContent = "云端数据库升级后可用";
  else if (state.cloudRole === "partner") {
    elements.responseSettingsHint.textContent = state.responsesEnabled ? "记录者允许你回应每日记录" : "记录者暂未开启回应";
  } else {
    elements.responseSettingsHint.textContent = state.responsesEnabled ? "伴侣可以对每日记录发送一句回应" : "伴侣回应已关闭，历史回应仍保留";
  }
}

async function changeResponsesEnabled() {
  if (state.cloudRole !== "owner" || !state.responsesAvailable) { renderResponseSettings(); return; }
  const next = elements.responsesEnabled.checked;
  elements.responsesEnabled.disabled = true;
  const success = await window.CloudSync?.setResponsesEnabled(next);
  if (!success) {
    renderResponseSettings();
    showToast("设置未保存，请检查网络后重试");
    return;
  }
  showToast(next ? "伴侣回应已开启" : "伴侣回应已关闭");
}

function savePartnerSettings() {
  state.settings.partnerName = elements.partnerName.value.trim();
  state.settings.partnerMessage = elements.partnerMessage.value.trim();
  state.settings.partnerShareCycle = elements.shareCycle.checked;
  state.settings.partnerShareBody = elements.shareBody.checked;
  state.settings.partnerShareMood = elements.shareMood.checked;
  persist();
}

function buildPartnerSummaryData() {
  const today = new Date(); const record = state.records[dateKey(today)]; const prediction = calculatePrediction();
  const starts = periodStarts().filter(date => date <= today); const latestStart = starts.at(-1);
  const cycleDay = latestStart ? daysBetween(latestStart, today) + 1 : null; const periodSegment = findPeriodSegment(today);
  let cycleStatus = "还在积累周期记录";
  if (periodSegment) cycleStatus = `经期第 ${daysBetween(periodSegment.start, today) + 1} 天`;
  else if (cycleDay && cycleDay > 0 && cycleDay <= 90) cycleStatus = `当前周期第 ${cycleDay} 天`;
  const body = [];
  const flow = { light: "经量少", medium: "经量中", heavy: "经量多", veryHeavy: "经量超多" }[record?.flow];
  const energy = { exhausted: "精力耗尽", low: "有些疲倦", normal: "精力正常", high: "精力充沛" }[record?.energy];
  const pain = { none: "无痛", mild: "轻微疼痛", moderate: "明显疼痛", severe: "严重疼痛" }[record?.pain];
  if (flow) body.push(flow); if (energy) body.push(energy); if (pain) body.push(pain);
  record?.painTypes?.forEach(id => { const item = PAIN_TYPES.find(type => type.id === id); if (item) body.push(item.label); });
  record?.symptoms?.forEach(id => { const item = SYMPTOMS.find(symptom => symptom.id === id); if (item) body.push(item.label); });
  const mood = { low: "情绪有些低落", calm: "情绪比较平静", sensitive: "今天比较敏感", irritable: "今天有些烦躁" }[record?.mood];
  const intimacy = hasIntimacyRecord(record)
    ? `同房${record.intimacyMode === "duration" ? `总时长 ${record.sexMinutes} 分钟` : ` ${record.sexCount} 次`}，保护措施：${{ all: "全部有", partial: "部分有", none: "均无", unknown: "未记录" }[record.protection] || "未记录"}`
    : "今天没有同房记录";
  const notes = [record?.customTags?.length ? `标签：${record.customTags.join("、")}` : "", record?.note ? `备注：${record.note}` : ""].filter(Boolean).join("；") || "今天没有标签或备注";
  return {
    partnerName: state.settings.partnerName || "亲爱的", message: state.settings.partnerMessage || "这是我今天的周期状态，希望我们都更了解身体的变化。",
    date: formatLongDate(today), cycleStatus,
    forecast: prediction ? `下次经期预计在 ${formatRange(prediction.startLower, prediction.startUpper)} 开始` : "继续记录后会显示预计日期",
    body: body.length ? `${body.slice(0, 6).join(" · ")}${body.length > 6 ? ` · 共 ${body.length} 项` : ""}` : "今天暂未记录身体感受", mood: mood || "今天暂未记录情绪", intimacy, notes,
    shareCycle: state.settings.partnerShareCycle !== false, shareBody: state.settings.partnerShareBody !== false,
    shareMood: state.settings.partnerShareMood !== false
  };
}

async function openPartnerSummary() {
  savePartnerSettings(); const data = buildPartnerSummaryData(); renderPartnerSummaryPreview(data);
  state.partnerSummaryBlob = null; elements.partnerSummaryDialog.showModal(); queueMicrotask(refreshIcons);
  const buttons = [document.querySelector("#downloadPartnerSummary"), document.querySelector("#sharePartnerSummary")];
  buttons.forEach(button => { button.disabled = true; });
  try { state.partnerSummaryBlob = await createPartnerSummaryBlob(data); }
  catch { showToast("无法生成摘要图片"); }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}

function renderPartnerSummaryPreview(data) {
  const preview = elements.partnerSummaryPreview; preview.replaceChildren();
  const header = document.createElement("div"); header.className = "summary-preview-header";
  const label = document.createElement("span"); label.textContent = "周期记 · 私密摘要";
  const date = document.createElement("small"); date.textContent = data.date; header.append(label, date);
  const title = document.createElement("h3"); title.textContent = `${data.partnerName}，这是我今天的状态`;
  const message = document.createElement("p"); message.className = "summary-message"; message.textContent = data.message;
  preview.append(header, title, message);
  if (data.shareCycle) appendSummaryPreviewSection(preview, "calendar-heart", "周期", data.cycleStatus, data.forecast);
  if (data.shareBody) appendSummaryPreviewSection(preview, "activity", "身体感受", data.body, "感受来自今天的主动记录");
  if (data.shareMood) appendSummaryPreviewSection(preview, "heart", "情绪", data.mood, "陪伴和理解就很好");
  appendSummaryPreviewSection(preview, "lock-keyhole", "亲密与备注", data.intimacy, data.notes);
  const footer = document.createElement("small"); footer.className = "summary-preview-footer"; footer.textContent = "仅供彼此了解，不作为医学判断"; preview.append(footer);
}

function appendSummaryPreviewSection(container, icon, label, value, copy) {
  const section = document.createElement("div"); section.className = "summary-preview-section";
  const iconWrap = document.createElement("span"); iconWrap.innerHTML = `<i data-lucide="${icon}"></i>`;
  const content = document.createElement("div"); const small = document.createElement("small"); small.textContent = label;
  const strong = document.createElement("strong"); strong.textContent = value; const detail = document.createElement("p"); detail.textContent = copy;
  content.append(small, strong, detail); section.append(iconWrap, content); container.append(section);
}

async function createPartnerSummaryBlob(data) {
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1680;
  const context = canvas.getContext("2d"); context.fillStyle = "#f2f6f4"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#087f6b"; context.fillRect(0, 0, canvas.width, 210);
  context.fillStyle = "#ffffff"; context.font = "700 46px sans-serif"; context.fillText("周期记", 72, 92);
  context.font = "400 27px sans-serif"; context.fillText("私密伴侣摘要", 72, 145); context.textAlign = "right"; context.fillText(data.date, 1008, 104); context.textAlign = "left";
  context.fillStyle = "#18211e"; context.font = "700 52px sans-serif"; drawWrappedText(context, `${data.partnerName}，这是我今天的状态`, 72, 300, 936, 68, 2);
  context.fillStyle = "#65716d"; context.font = "400 31px sans-serif"; const messageBottom = drawWrappedText(context, data.message, 72, 420, 936, 48, 3);
  let y = Math.max(560, messageBottom + 54);
  if (data.shareCycle) y = drawSummaryCanvasSection(context, y, "周期", data.cycleStatus, data.forecast, "#d83f5b", "#fde7eb");
  if (data.shareBody) y = drawSummaryCanvasSection(context, y, "身体感受", data.body, "感受来自今天的主动记录", "#4b64ad", "#e8ecfa");
  if (data.shareMood) y = drawSummaryCanvasSection(context, y, "情绪", data.mood, "陪伴和理解就很好", "#9b4d7d", "#f3dfeb");
  y = drawSummaryCanvasSection(context, y, "亲密与备注", data.intimacy, data.notes, "#087f6b", "#dff2ed");
  const footerY = Math.min(1620, y + 20);
  context.strokeStyle = "#dce3df"; context.beginPath(); context.moveTo(72, footerY - 42); context.lineTo(1008, footerY - 42); context.stroke();
  context.fillStyle = "#65716d"; context.font = "400 25px sans-serif"; context.fillText("仅供彼此了解，不作为医学判断", 72, footerY);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("canvas")), "image/png"));
}

function drawSummaryCanvasSection(context, y, label, value, copy, accent, soft) {
  context.fillStyle = "#ffffff"; context.beginPath(); context.roundRect(72, y, 936, 205, 18); context.fill();
  context.fillStyle = soft; context.beginPath(); context.arc(132, y + 66, 30, 0, Math.PI * 2); context.fill();
  context.fillStyle = accent; context.beginPath(); context.arc(132, y + 66, 11, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#65716d"; context.font = "600 25px sans-serif"; context.fillText(label, 188, y + 52);
  context.fillStyle = "#18211e"; context.font = "700 34px sans-serif"; drawWrappedText(context, value, 188, y + 100, 750, 42, 2);
  context.fillStyle = "#65716d"; context.font = "400 24px sans-serif"; context.fillText(copy, 188, y + 174); return y + 229;
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const characters = [...text]; let line = "", lineIndex = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const test = line + characters[index];
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line, x, y + lineIndex * lineHeight); line = characters[index]; lineIndex += 1;
      if (lineIndex >= maxLines) return y + lineIndex * lineHeight;
    } else line = test;
  }
  if (lineIndex < maxLines) { context.fillText(line, x, y + lineIndex * lineHeight); lineIndex += 1; }
  return y + lineIndex * lineHeight;
}

async function downloadPartnerSummary() {
  if (!state.partnerSummaryBlob) return;
  downloadBlob(state.partnerSummaryBlob, `周期记-伴侣摘要-${dateKey(new Date())}.png`); showToast("摘要图片已保存");
}

async function sharePartnerSummary() {
  if (!state.partnerSummaryBlob) return;
  const file = new File([state.partnerSummaryBlob], `周期记-伴侣摘要-${dateKey(new Date())}.png`, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "周期记伴侣摘要" }); }
    catch (error) { if (error.name !== "AbortError") showToast("系统分享未完成，可以保存图片后发送"); }
  } else { downloadBlob(state.partnerSummaryBlob, file.name); showToast("当前浏览器不支持直接分享，已保存图片"); }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleReminderToggle() {
  state.settings.reminderEnabled = elements.reminderEnabled.checked;
  if (state.settings.reminderEnabled && "Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  persist(); renderReminderSettings(); renderToday();
  showToast(state.settings.reminderEnabled ? "经期提醒已开启" : "经期提醒已关闭");
}

function saveReminderSettings() {
  state.settings.reminderDays = clamp(Number(elements.reminderDays.value) || 0, 0, 3);
  state.settings.reminderTime = /^\d{2}:\d{2}$/.test(elements.reminderTime.value) ? elements.reminderTime.value : "09:00";
  state.settings.lastReminderKey = null; persist(); renderReminderSettings();
}

function reminderLeadLabel() {
  const days = clamp(Number(state.settings.reminderDays) || 0, 0, 3);
  return days ? `提前 ${days} 天` : "预计当天";
}

async function testReminder() {
  if (!("Notification" in window)) { showToast("当前浏览器不支持通知，请使用系统日历提醒"); return; }
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") { showToast("通知权限未开启，请检查浏览器网站权限"); renderReminderSettings(); return; }
  await showSystemNotification("周期记提醒测试", "通知可以正常显示。预计日期仍会根据记录变化。", "cycle-journal-test");
  showToast("测试通知已发送");
}

async function checkPredictionReminder() {
  if (!state.settings.reminderEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const prediction = calculatePrediction(); if (!prediction) return;
  const reminderDate = addDays(prediction.start, -clamp(Number(state.settings.reminderDays) || 0, 0, 3));
  const [hour, minute] = (state.settings.reminderTime || "09:00").split(":").map(Number);
  reminderDate.setHours(hour, minute, 0, 0);
  const now = new Date(); const deadline = addDays(prediction.startUpper, 1);
  const reminderKey = `${dateKey(prediction.start)}-${state.settings.reminderDays}`;
  if (now < reminderDate || now >= deadline || state.settings.lastReminderKey === reminderKey) return;
  const days = daysBetween(startOfDay(now), prediction.start);
  const title = days <= 0 ? "你今天可能会来月经" : `预计还有 ${days} 天来月经`;
  await showSystemNotification(title, `预计开始区间：${formatRange(prediction.startLower, prediction.startUpper)}。`, `cycle-journal-${dateKey(prediction.start)}`);
  state.settings.lastReminderKey = reminderKey; persist();
}

async function showSystemNotification(title, body, tag) {
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.ready;
    return registration.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
  }
  return new Notification(title, { body, tag, icon: "icons/icon-192.png" });
}

function exportPredictionCalendar() {
  const prediction = calculatePrediction();
  if (!prediction) { showToast("至少记录两次经期开始日期后才能导出"); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = calendarDate(prediction.startLower); const end = calendarDate(addDays(prediction.startUpper, 1));
  const reminderDate = addDays(prediction.start, -clamp(Number(state.settings.reminderDays) || 0, 0, 3));
  const reminderStart = `${calendarDate(reminderDate)}T${(state.settings.reminderTime || "09:00").replace(":", "")}00`;
  const reminderEndDate = new Date(reminderDate); reminderEndDate.setMinutes(reminderEndDate.getMinutes() + 15);
  const reminderEnd = `${calendarDate(reminderEndDate)}T${String(reminderEndDate.getHours()).padStart(2, "0")}${String(reminderEndDate.getMinutes()).padStart(2, "0")}00`;
  const uid = `cycle-journal-${dateKey(prediction.start)}@local`;
  const content = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cycle Journal//ZH-CN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
    "SUMMARY:预计经期开始区间", "DESCRIPTION:根据本机历史记录估算，仅供记录参考，不用于避孕、诊断或治疗。",
    "TRANSP:TRANSPARENT", "END:VEVENT",
    "BEGIN:VEVENT", `UID:reminder-${uid}`, `DTSTAMP:${stamp}`, `DTSTART:${reminderStart}`, `DTEND:${reminderEnd}`,
    "SUMMARY:经期预计临近", `DESCRIPTION:预计开始区间为 ${formatRange(prediction.startLower, prediction.startUpper)}。`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT0M", "DESCRIPTION:经期预计临近", "END:VALARM", "END:VEVENT",
    "END:VCALENDAR", ""
  ].join("\r\n");
  downloadText(content, `周期记-预计日期-${dateKey(prediction.start)}.ics`, "text/calendar;charset=utf-8");
  showToast("日历文件已导出");
}
function calendarDate(date) { return dateKey(date).replaceAll("-", ""); }

async function clearAllData() {
  state.records = {};
  state.settings = { ...DEFAULT_SETTINGS };
  localStorage.removeItem(storageKey(DRAFT_KEY));
  localStorage.removeItem(storageKey(PRE_V9_BACKUP_KEY));
  await persist();
  await deleteIndexedSnapshot("latest");
  render();
  const synced = state.cloudRole === "owner" ? await window.CloudSync?.syncNow() : true;
  showToast(synced === false ? "本机已清除，云端将在联网后清除" : "全部数据已清除");
}
function showView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === viewId));
  if (viewId === "insightsView") renderInsights(); if (viewId === "todayView") renderToday();
  queueMicrotask(refreshIcons);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }
let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 1800);
}
function formatShortDate(date) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date); }
function formatLongDate(date) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date); }
function formatRange(start, end) {
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) return `${start.getMonth() + 1}月${start.getDate()}–${end.getDate()}日`;
  return `${formatShortDate(start)}–${formatShortDate(end)}`;
}
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function median(values) {
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}
function standardDeviation(values) {
  if (values.length < 2) return 0; const mean = average(values);
  return Math.sqrt(average(values.map(value => (value - mean) ** 2)));
}
