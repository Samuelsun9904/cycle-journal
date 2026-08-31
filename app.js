const STORAGE_KEY = "cycle-journal-v1";
const state = {
  month: startOfMonth(new Date()),
  selectedDate: null,
  records: loadRecords()
};

const elements = {
  monthTitle: document.querySelector("#monthTitle"),
  cycleSummary: document.querySelector("#cycleSummary"),
  calendarGrid: document.querySelector("#calendarGrid"),
  recordDialog: document.querySelector("#recordDialog"),
  recordDateTitle: document.querySelector("#recordDateTitle"),
  hadSex: document.querySelector("#hadSexInput"),
  protectionRow: document.querySelector("#protectionRow"),
  flowFieldset: document.querySelector("#flowFieldset"),
  note: document.querySelector("#noteInput"),
  deleteRecord: document.querySelector("#deleteRecord"),
  metrics: document.querySelector("#metrics"),
  historyList: document.querySelector("#historyList"),
  toast: document.querySelector("#toast")
};

document.querySelector("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", {
  month: "long", day: "numeric", weekday: "long"
}).format(new Date());

document.querySelector("#previousMonth").addEventListener("click", () => changeMonth(-1));
document.querySelector("#nextMonth").addEventListener("click", () => changeMonth(1));
document.querySelector("#todayButton").addEventListener("click", () => {
  state.month = startOfMonth(new Date());
  showView("calendarView");
  render();
});
document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
document.querySelectorAll('input[name="period"]').forEach(input => input.addEventListener("change", updateFormVisibility));
elements.hadSex.addEventListener("change", updateFormVisibility);
document.querySelector("#saveRecord").addEventListener("click", saveCurrentRecord);
elements.deleteRecord.addEventListener("click", deleteCurrentRecord);
document.querySelector("#exportButton").addEventListener("click", exportData);
document.querySelector("#importInput").addEventListener("change", importData);
document.querySelector("#clearButton").addEventListener("click", () => document.querySelector("#confirmDialog").showModal());
document.querySelector("#confirmClear").addEventListener("click", clearAllData);

function loadRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && typeof parsed === "object" ? parsed.records || {} : {};
  } catch {
    return {};
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: state.records }));
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1, 12); }
function addDays(date, count) { const result = new Date(date); result.setDate(result.getDate() + count); return result; }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / 86400000); }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function isSameDay(a, b) { return dateKey(a) === dateKey(b); }

function changeMonth(offset) {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + offset, 1, 12);
  render();
}

function render() {
  renderCalendar();
  renderInsights();
}

function renderCalendar() {
  elements.monthTitle.textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(state.month);
  const prediction = calculatePrediction();
  elements.cycleSummary.textContent = prediction
    ? `下次预计 ${formatShortDate(prediction.start)} 前后`
    : "记录至少 2 次经期开始后显示预测";

  const first = startOfMonth(state.month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -mondayOffset);
  elements.calendarGrid.replaceChildren();

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const key = dateKey(date);
    const record = state.records[key];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day";
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", dayAriaLabel(date, record));
    if (date.getMonth() !== state.month.getMonth()) button.classList.add("outside");
    if (isSameDay(date, new Date())) button.classList.add("today");
    if (record?.period && record.period !== "none") button.classList.add("period");
    if (isPredictedDate(date, prediction)) button.classList.add("predicted");
    button.innerHTML = `<span class="day-number">${date.getDate()}</span><span class="day-markers"></span>`;
    const markers = button.querySelector(".day-markers");
    if (record?.period && record.period !== "none") markers.append(makeMarker("period-marker"));
    if (record?.hadSex) markers.append(makeMarker("sex-marker"));
    button.addEventListener("click", () => openRecordDialog(date));
    elements.calendarGrid.append(button);
  }
}

function makeMarker(className) {
  const marker = document.createElement("i");
  marker.className = `marker ${className}`;
  return marker;
}

function dayAriaLabel(date, record) {
  const pieces = [new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(date)];
  if (record?.period && record.period !== "none") pieces.push("经期");
  if (record?.hadSex) pieces.push("同房记录");
  return pieces.join("，");
}

function openRecordDialog(date) {
  state.selectedDate = date;
  const record = state.records[dateKey(date)] || {};
  elements.recordDateTitle.textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short"
  }).format(date);
  setRadio("period", record.period || "none");
  setRadio("flow", record.flow || "medium");
  elements.hadSex.checked = Boolean(record.hadSex);
  setRadio("protection", record.protection || "unknown");
  elements.note.value = record.note || "";
  elements.deleteRecord.hidden = !state.records[dateKey(date)];
  updateFormVisibility();
  elements.recordDialog.showModal();
}

function setRadio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function selectedRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function updateFormVisibility() {
  const hasPeriod = selectedRadio("period") !== "none";
  elements.flowFieldset.hidden = !hasPeriod;
  elements.protectionRow.hidden = !elements.hadSex.checked;
}

function saveCurrentRecord() {
  const key = dateKey(state.selectedDate);
  const period = selectedRadio("period");
  const record = {
    period,
    flow: period === "none" ? null : selectedRadio("flow"),
    hadSex: elements.hadSex.checked,
    protection: elements.hadSex.checked ? selectedRadio("protection") : null,
    note: elements.note.value.trim()
  };
  if (period === "none" && !record.hadSex && !record.note) delete state.records[key];
  else state.records[key] = record;
  persist();
  elements.recordDialog.close();
  render();
  showToast("已保存");
}

function deleteCurrentRecord() {
  delete state.records[dateKey(state.selectedDate)];
  persist();
  elements.recordDialog.close();
  render();
  showToast("记录已删除");
}

function periodStarts() {
  return Object.entries(state.records)
    .filter(([, record]) => record.period === "start")
    .map(([key]) => parseDate(key))
    .sort((a, b) => a - b);
}

function calculatePrediction() {
  const starts = periodStarts();
  if (starts.length < 2) return null;
  const recent = starts.slice(-7);
  const intervals = recent.slice(1).map((date, index) => daysBetween(recent[index], date)).filter(days => days >= 15 && days <= 60);
  if (!intervals.length) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const latest = recent.at(-1);
  const lengths = periodLengths();
  const periodLength = lengths.length ? Math.round(average(lengths.slice(-6))) : 5;
  return { start: addDays(latest, median), cycleLength: median, periodLength, variation: Math.max(1, Math.round(range(intervals) / 2)) };
}

function periodLengths() {
  const starts = periodStarts();
  return starts.map(start => {
    let count = 0;
    for (let offset = 0; offset < 12; offset += 1) {
      const record = state.records[dateKey(addDays(start, offset))];
      if (record?.period && record.period !== "none") count += 1;
      else if (offset > 0) break;
    }
    return count;
  }).filter(Boolean);
}

function isPredictedDate(date, prediction) {
  if (!prediction) return false;
  const start = addDays(prediction.start, -prediction.variation);
  const end = addDays(prediction.start, prediction.periodLength - 1 + prediction.variation);
  return date >= startOfDay(start) && date <= startOfDay(end);
}

function renderInsights() {
  const prediction = calculatePrediction();
  const starts = periodStarts();
  const lengths = periodLengths();
  const intervals = starts.slice(1).map((date, index) => daysBetween(starts[index], date)).filter(days => days >= 15 && days <= 60);
  const sexCount = Object.values(state.records).filter(record => record.hadSex).length;
  const values = [
    [intervals.length ? `${Math.round(average(intervals.slice(-6)))} 天` : "--", "平均周期"],
    [lengths.length ? `${Math.round(average(lengths.slice(-6)))} 天` : "--", "平均经期"],
    [prediction ? formatShortDate(prediction.start) : "--", "下次预计"],
    [String(sexCount), "同房记录"]
  ];
  elements.metrics.innerHTML = values.map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const recentStarts = starts.slice(-8).reverse();
  if (!recentStarts.length) {
    elements.historyList.innerHTML = '<div class="empty-state">尚无经期开始记录</div>';
    return;
  }
  elements.historyList.innerHTML = recentStarts.map((date, index) => {
    const previous = recentStarts[index + 1];
    const cycle = previous ? `${daysBetween(previous, date)} 天周期` : "首次记录";
    return `<div class="history-row"><div><strong>${formatLongDate(date)}</strong><span>经期开始</span></div><span>${cycle}</span></div>`;
  }).join("");
}

function exportData() {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records: state.records }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `周期记备份-${dateKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("备份已导出");
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== "object") throw new Error("invalid");
    state.records = parsed.records;
    persist();
    render();
    showToast("备份已恢复");
  } catch {
    showToast("无法读取这个备份文件");
  } finally {
    event.target.value = "";
  }
}

function clearAllData() {
  state.records = {};
  persist();
  render();
  showToast("全部数据已清除");
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === viewId));
  if (viewId === "insightsView") renderInsights();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 1800);
}

function formatShortDate(date) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date); }
function formatLongDate(date) { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date); }
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function range(values) { return Math.max(...values) - Math.min(...values); }

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
render();
