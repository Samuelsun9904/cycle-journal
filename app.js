const STORAGE_KEY = "cycle-journal-v1";
const BACKUP_ITERATIONS = 250000;
const SYMPTOMS = [
  { id: "cramps", label: "腹痛" }, { id: "headache", label: "头痛" },
  { id: "backache", label: "腰痛" }, { id: "breast", label: "乳房胀痛" },
  { id: "bloating", label: "腹胀" }, { id: "acne", label: "痘痘" },
  { id: "tired", label: "疲惫" }, { id: "lowMood", label: "情绪低落" },
  { id: "irritable", label: "烦躁" }, { id: "poorSleep", label: "睡眠不佳" },
  { id: "appetite", label: "食欲变化" }, { id: "discharge", label: "分泌物变化" }
];

const stored = loadStore();
const state = {
  month: startOfMonth(new Date()), selectedDate: null, records: stored.records,
  settings: stored.settings, calendarFilter: "all", periodRangeOriginal: null,
  pendingImport: null, backupMode: "export"
};

const elements = {
  monthTitle: document.querySelector("#monthTitle"), cycleSummary: document.querySelector("#cycleSummary"),
  calendarGrid: document.querySelector("#calendarGrid"), recordDialog: document.querySelector("#recordDialog"),
  recordDateTitle: document.querySelector("#recordDateTitle"), hadSex: document.querySelector("#hadSexInput"),
  spotting: document.querySelector("#spottingInput"), protectionRow: document.querySelector("#protectionRow"),
  flowFieldset: document.querySelector("#flowFieldset"), note: document.querySelector("#noteInput"),
  customTags: document.querySelector("#customTagsInput"), deleteRecord: document.querySelector("#deleteRecord"),
  editPeriodRange: document.querySelector("#editPeriodRange"), symptomOptions: document.querySelector("#symptomOptions"),
  metrics: document.querySelector("#metrics"), historyList: document.querySelector("#historyList"),
  cycleChart: document.querySelector("#cycleChart"), symptomSummary: document.querySelector("#symptomSummary"),
  todayCycleLabel: document.querySelector("#todayCycleLabel"), todayStatus: document.querySelector("#todayStatus"),
  todayForecast: document.querySelector("#todayForecast"), confidenceBadge: document.querySelector("#confidenceBadge"),
  todayRecord: document.querySelector("#todayRecord"), backupReminder: document.querySelector("#backupReminder"),
  backupStatus: document.querySelector("#backupStatus"), periodRangeDialog: document.querySelector("#periodRangeDialog"),
  periodStart: document.querySelector("#periodStartInput"), periodEnd: document.querySelector("#periodEndInput"),
  deletePeriodRange: document.querySelector("#deletePeriodRange"), backupDialog: document.querySelector("#backupDialog"),
  backupPassword: document.querySelector("#backupPassword"), backupPasswordConfirm: document.querySelector("#backupPasswordConfirm"),
  backupError: document.querySelector("#backupError"), toast: document.querySelector("#toast")
};

initialize();

function initialize() {
  document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long", day: "numeric", weekday: "long"
  }).format(new Date());
  renderSymptomOptions();
  bindEvents();
  render();
  persist();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }));
  }
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
  elements.hadSex.addEventListener("change", updateFormVisibility);
  document.querySelector("#saveRecord").addEventListener("click", saveCurrentRecord);
  elements.deleteRecord.addEventListener("click", deleteCurrentRecord);
  elements.editPeriodRange.addEventListener("click", editSelectedPeriodRange);
  document.querySelector("#logTodayButton").addEventListener("click", () => openRecordDialog(new Date()));
  document.querySelector("#editTodayButton").addEventListener("click", () => openRecordDialog(new Date()));
  document.querySelector("#logPeriodRangeButton").addEventListener("click", () => openPeriodRangeDialog(new Date()));
  document.querySelector("#savePeriodRange").addEventListener("click", savePeriodRange);
  elements.deletePeriodRange.addEventListener("click", deleteCurrentPeriodRange);
  document.querySelector("#exportButton").addEventListener("click", () => openBackupDialog("export"));
  elements.backupReminder.addEventListener("click", () => openBackupDialog("export"));
  document.querySelector("#confirmBackupAction").addEventListener("click", runBackupAction);
  document.querySelector("#importInput").addEventListener("change", importData);
  document.querySelector("#clearButton").addEventListener("click", () => document.querySelector("#confirmDialog").showModal());
  document.querySelector("#confirmClear").addEventListener("click", clearAllData);
}

function loadStore() {
  const defaults = { records: {}, settings: { lastBackupAt: null } };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || typeof parsed !== "object" || typeof parsed.records !== "object") return defaults;
    const records = Object.fromEntries(Object.entries(parsed.records).map(([key, record]) => [key, normalizeRecord(record)]));
    return { records, settings: { ...defaults.settings, ...(parsed.settings || {}) } };
  } catch { return defaults; }
}

function normalizeRecord(record = {}) {
  return {
    period: record.period || "none", flow: record.flow || null, spotting: Boolean(record.spotting),
    hadSex: Boolean(record.hadSex), protection: record.protection || null,
    symptoms: Array.isArray(record.symptoms) ? record.symptoms.filter(id => SYMPTOMS.some(item => item.id === id)) : [],
    customTags: Array.isArray(record.customTags) ? record.customTags.filter(Boolean) : [],
    note: typeof record.note === "string" ? record.note : ""
  };
}

function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, records: state.records, settings: state.settings })); }
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
function render() { renderToday(); renderCalendar(); renderInsights(); renderBackupStatus(); }

function renderToday() {
  const today = new Date();
  const todayRecord = state.records[dateKey(today)];
  const starts = periodStarts().filter(date => date <= today);
  const latestStart = starts.at(-1);
  const cycleDay = latestStart ? daysBetween(latestStart, today) + 1 : null;
  const periodSegment = findPeriodSegment(today);
  const prediction = calculatePrediction();
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
  elements.todayRecord.replaceChildren();
  const chips = recordLabels(todayRecord);
  if (!chips.length) {
    const empty = document.createElement("p"); empty.className = "empty-inline"; empty.textContent = "今天还没有记录";
    elements.todayRecord.append(empty);
  } else chips.forEach(label => elements.todayRecord.append(createTag(label)));
  const recordCount = Object.keys(state.records).length;
  const lastBackup = state.settings.lastBackupAt ? new Date(state.settings.lastBackupAt) : null;
  elements.backupReminder.hidden = recordCount < 5 || (lastBackup && daysBetween(lastBackup, today) < 30);
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
  if (record.spotting) labels.push("点滴出血");
  if (record.hadSex) labels.push("同房");
  record.symptoms?.forEach(id => { const item = SYMPTOMS.find(symptom => symptom.id === id); if (item) labels.push(item.label); });
  labels.push(...(record.customTags || []));
  if (record.note) labels.push("有备注");
  return labels;
}

function createTag(label) { const span = document.createElement("span"); span.className = "record-tag"; span.textContent = label; return span; }

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
    if (record?.hadSex) markers.append(makeMarker("sex-marker"));
    if (record?.spotting || record?.symptoms?.length || record?.customTags?.length) markers.append(makeMarker("symptom-marker"));
    button.addEventListener("click", () => openRecordDialog(date)); elements.calendarGrid.append(button);
  }
}

function matchesCalendarFilter(record) {
  if (state.calendarFilter === "all") return true;
  if (state.calendarFilter === "period") return Boolean(record?.period && record.period !== "none");
  if (state.calendarFilter === "sex") return Boolean(record?.hadSex);
  return Boolean(record?.spotting || record?.symptoms?.length || record?.customTags?.length);
}
function makeMarker(className) { const marker = document.createElement("i"); marker.className = `marker ${className}`; return marker; }
function dayAriaLabel(date, record) {
  return [new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date), ...recordLabels(record)].join("，");
}

function renderSymptomOptions() {
  elements.symptomOptions.replaceChildren();
  SYMPTOMS.forEach(symptom => {
    const label = document.createElement("label"); label.className = "choice-chip";
    label.innerHTML = `<input type="checkbox" name="symptoms" value="${symptom.id}"><span>${symptom.label}</span>`;
    elements.symptomOptions.append(label);
  });
}

function openRecordDialog(date) {
  state.selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const record = state.records[dateKey(state.selectedDate)] || normalizeRecord();
  elements.recordDateTitle.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short"
  }).format(state.selectedDate);
  setRadio("period", record.period || "none"); setRadio("flow", record.flow || "medium");
  elements.spotting.checked = Boolean(record.spotting); elements.hadSex.checked = Boolean(record.hadSex);
  setRadio("protection", record.protection || "unknown");
  document.querySelectorAll('input[name="symptoms"]').forEach(input => { input.checked = record.symptoms.includes(input.value); });
  elements.customTags.value = record.customTags.join("、"); elements.note.value = record.note || "";
  elements.deleteRecord.hidden = !state.records[dateKey(state.selectedDate)];
  elements.editPeriodRange.hidden = !(record.period && record.period !== "none");
  updateFormVisibility(); elements.recordDialog.showModal();
}

function setRadio(name, value) { const input = document.querySelector(`input[name="${name}"][value="${value}"]`); if (input) input.checked = true; }
function selectedRadio(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
function updateFormVisibility() {
  elements.flowFieldset.hidden = selectedRadio("period") === "none";
  elements.protectionRow.hidden = !elements.hadSex.checked;
}

function saveCurrentRecord() {
  const key = dateKey(state.selectedDate); const period = selectedRadio("period");
  const record = normalizeRecord({
    period, flow: period === "none" ? null : selectedRadio("flow"), spotting: elements.spotting.checked,
    hadSex: elements.hadSex.checked, protection: elements.hadSex.checked ? selectedRadio("protection") : null,
    symptoms: [...document.querySelectorAll('input[name="symptoms"]:checked')].map(input => input.value),
    customTags: parseTags(elements.customTags.value), note: elements.note.value.trim()
  });
  if (recordHasData(record)) state.records[key] = record; else delete state.records[key];
  persist(); elements.recordDialog.close(); render(); showToast("已保存");
}
function parseTags(value) { return [...new Set(value.split(/[，,、]/).map(item => item.trim()).filter(Boolean))].slice(0, 8); }
function recordHasData(record) {
  return Boolean((record.period && record.period !== "none") || record.spotting || record.hadSex || record.symptoms?.length || record.customTags?.length || record.note);
}
function deleteCurrentRecord() {
  delete state.records[dateKey(state.selectedDate)]; persist(); elements.recordDialog.close(); render(); showToast("记录已删除");
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
  renderCycleChart(intervals.slice(-6)); renderSymptomSummary();
  const recentStarts = starts.slice(-8).reverse();
  if (!recentStarts.length) { elements.historyList.innerHTML = '<div class="empty-state">尚无经期开始记录</div>'; return; }
  elements.historyList.innerHTML = recentStarts.map((date, index) => {
    const previous = recentStarts[index + 1]; const cycle = previous ? `${daysBetween(previous, date)} 天周期` : "首次记录";
    return `<div class="history-row"><div><strong>${formatLongDate(date)}</strong><span>经期开始</span></div><span>${cycle}</span></div>`;
  }).join("");
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
  Object.values(state.records).forEach(record => record.symptoms?.forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!ranked.length) { elements.symptomSummary.innerHTML = '<div class="empty-state">记录症状后显示出现频率</div>'; return; }
  const max = ranked[0][1]; elements.symptomSummary.replaceChildren();
  ranked.forEach(([id, count]) => {
    const row = document.createElement("div"); row.className = "symptom-bar-row";
    const label = SYMPTOMS.find(item => item.id === id)?.label || id;
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
  state.settings = { lastBackupAt: null, ...(payload.settings || {}) }; persist(); render();
}
async function deriveBackupKey(password, salt, usages, iterations = BACKUP_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, usages);
}
function bytesToBase64(bytes) { let binary = ""; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0)); }
function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearAllData() { state.records = {}; state.settings = { lastBackupAt: null }; persist(); render(); showToast("全部数据已清除"); }
function showView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === viewId));
  if (viewId === "insightsView") renderInsights(); if (viewId === "todayView") renderToday();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
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
