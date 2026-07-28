const state = {
  info: null,
  crop: null,
  preview: null,
  markers: [],
  addTeam: "blue",
  batchPaths: [],
  batchInspections: [],
  calibrationIndex: 0,
  calibrationSecondDirty: false,
  results: [],
  result: null,
  currentResultIndex: 0,
  roles: {},
  names: {},
  playing: false,
  forecast: false,
};

const ROLES = ["对抗路", "打野", "中单", "发育路", "辅助"];
const REGIONS = [
  "己方红区",
  "己方蓝区",
  "对方红区",
  "对方蓝区",
  "对抗路",
  "中路",
  "发育路",
];
const TEAM_NAME = { blue: "蓝方", red: "红方" };
const $ = (selector) => document.querySelector(selector);

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 3600);
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    Math.floor(value % 60),
  ).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStep(step) {
  document.querySelectorAll(".steps span").forEach((item) => {
    item.classList.toggle("active", Number(item.dataset.step) <= step);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "操作失败");
  return data;
}

function rawVideoInputs() {
  return $("#videoPaths")
    .value.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function resolveVideoPaths() {
  const inputs = rawVideoInputs();
  if (!inputs.length) throw new Error("请输入至少一个视频或文件夹路径");
  const data = await api("/api/resolve-videos", {
    method: "POST",
    body: JSON.stringify({ paths: inputs }),
  });
  state.batchPaths = data.paths;
  return data;
}

function calibrationSecondValue() {
  const raw = $("#calibrationSecond").value.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function updateMarkerCount() {
  const blue = state.markers.filter((marker) => marker.team === "blue").length;
  const red = state.markers.filter((marker) => marker.team === "red").length;
  $("#markerCount").textContent = `蓝方 ${blue}/5 · 红方 ${red}/5`;
  $("#analyzeButton").disabled =
    blue !== 5 ||
    red !== 5 ||
    !$("#confirmCalibration").checked ||
    !state.batchPaths.length ||
    state.calibrationSecondDirty ||
    calibrationSecondValue() === null;
  updateCalibrationControls();
}

function renderCalibrationMarkers() {
  const layer = $("#calibrationMarkers");
  layer.innerHTML = "";
  state.markers.forEach((marker, index) => {
    const button = document.createElement("button");
    button.className = `map-marker ${marker.team}`;
    button.style.left = `${(marker.x / state.info.mapWidth) * 100}%`;
    button.style.top = `${(marker.y / state.info.mapHeight) * 100}%`;
    button.textContent = index + 1;
    button.title = "点击删除此标记";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.markers.splice(index, 1);
      $("#confirmCalibration").checked = false;
      renderCalibrationMarkers();
    });
    layer.appendChild(button);
  });
  updateMarkerCount();
}

function cloneMarkers(markers) {
  return markers.map((marker) => ({ ...marker }));
}

function currentVideoName() {
  const path = state.batchPaths[state.calibrationIndex] || "";
  return path.split(/[\\/]/).pop() || path;
}

function updateCalibrationControls() {
  const total = Math.max(1, state.batchPaths.length);
  const current = Math.min(state.calibrationIndex + 1, total);
  $("#calibrationProgress").textContent =
    `第 ${current}/${total} 场 · ${currentVideoName() || "等待视频"}`;
  $("#previousCalibrationButton").disabled =
    !state.batchPaths.length || state.calibrationIndex === 0;
  $("#inspectButton").textContent = state.batchPaths.length
    ? `读取第 ${state.calibrationIndex + 1} 场校准画面`
    : "读取首场校准画面";
  if (state.batchPaths.length === 1) {
    $("#analyzeButton").textContent = "确认本场并开始分析";
  } else if (state.calibrationIndex < state.batchPaths.length - 1) {
    $("#analyzeButton").textContent = "确认本场并校准下一场";
  } else {
    $("#analyzeButton").textContent = "确认全部并开始分析";
  }
}

function persistCurrentCalibration() {
  if (!state.batchPaths.length || !state.info) return;
  const existing = state.batchInspections[state.calibrationIndex] || {};
  state.batchInspections[state.calibrationIndex] = {
    ...existing,
    path: state.batchPaths[state.calibrationIndex],
    info: { ...state.info },
    crop: { ...state.crop },
    preview: state.preview,
    markers: cloneMarkers(state.markers),
    calibrationSecond: calibrationSecondValue(),
    confirmed:
      $("#confirmCalibration").checked &&
      !state.calibrationSecondDirty &&
      calibrationSecondValue() !== null,
  };
}

function applyInspection(inspection, index) {
  state.calibrationIndex = index;
  state.info = {
    ...inspection.info,
    mapWidth: inspection.mapWidth ?? inspection.info.mapWidth,
    mapHeight: inspection.mapHeight ?? inspection.info.mapHeight,
  };
  state.crop = { ...inspection.crop };
  state.preview = inspection.preview;
  state.markers = cloneMarkers(inspection.markers);
  state.calibrationSecondDirty = false;
  $("#previewImage").src = inspection.preview;
  $("#calibrationSecond").value = inspection.calibrationSecond;
  $("#confirmCalibration").checked = Boolean(inspection.confirmed);
  $("#videoMeta").textContent =
    `${state.batchPaths.length} 场 · 当前 ${index + 1}/${state.batchPaths.length} · ` +
    `${inspection.info.width}×${inspection.info.height} · ${formatTime(
      inspection.info.duration,
    )}`;
  renderCalibrationMarkers();
}

async function loadCalibration(index, reload = false) {
  const path = state.batchPaths[index];
  if (!path) return;
  $("#analyzeButton").disabled = true;
  let inspection = state.batchInspections[index];
  if (!inspection || reload) {
    const calibrationSecond = calibrationSecondValue();
    if (calibrationSecond === null) {
      throw new Error("请先为当前视频填写校准秒数");
    }
    const data = await api("/api/inspect", {
      method: "POST",
      body: JSON.stringify({
        path,
        calibrationSecond,
      }),
    });
    inspection = {
      ...data,
      path,
      markers: cloneMarkers(data.markers),
      confirmed: false,
    };
    state.batchInspections[index] = inspection;
  }
  applyInspection(inspection, index);
}

function prepareCalibrationInput(index) {
  state.calibrationIndex = index;
  state.info = null;
  state.crop = null;
  state.preview = null;
  state.markers = [];
  state.calibrationSecondDirty = true;
  $("#previewImage").removeAttribute("src");
  $("#calibrationMarkers").innerHTML = "";
  $("#calibrationSecond").value = "";
  $("#confirmCalibration").checked = false;
  $("#videoMeta").textContent =
    `${state.batchPaths.length} 场 · 当前 ${index + 1}/${state.batchPaths.length} · ` +
    "请填写本场校准秒数";
  updateMarkerCount();
}

async function inspectVideo() {
  const button = $("#inspectButton");
  button.disabled = true;
  button.textContent = "正在读取…";
  try {
    if (calibrationSecondValue() === null) {
      throw new Error("请先为第一场视频填写校准秒数");
    }
    const resolved = await resolveVideoPaths();
    state.batchInspections = new Array(state.batchPaths.length);
    state.calibrationIndex = 0;
    await loadCalibration(0, true);
    $("#calibrationSection").classList.remove("hidden");
    setStep(2);
    const missing = resolved.missing?.length
      ? `；另有 ${resolved.missing.length} 个路径未找到`
      : "";
    toast(
      `已找到 ${state.batchPaths.length} 场视频，请逐场核对十个头像${missing}`,
    );
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    updateCalibrationControls();
  }
}

async function advanceCalibration() {
  persistCurrentCalibration();
  const current = state.batchInspections[state.calibrationIndex];
  const blue = current.markers.filter((marker) => marker.team === "blue").length;
  const red = current.markers.filter((marker) => marker.team === "red").length;
  if (blue !== 5 || red !== 5 || !current.confirmed) {
    toast("请确认本场蓝红双方各 5 个头像，并勾选核对确认", true);
    return;
  }
  if (state.calibrationIndex < state.batchPaths.length - 1) {
    try {
      const nextIndex = state.calibrationIndex + 1;
      if (state.batchInspections[nextIndex]) {
        await loadCalibration(nextIndex, false);
      } else {
        prepareCalibrationInput(nextIndex);
      }
      toast(`请为第 ${nextIndex + 1} 场填写校准秒数并读取画面`);
    } catch (error) {
      toast(error.message, true);
    }
    return;
  }
  if (
    state.batchInspections.length !== state.batchPaths.length ||
    state.batchInspections.some((inspection) => !inspection?.confirmed)
  ) {
    toast("仍有视频尚未完成头像校准", true);
    return;
  }
  beginAnalysis();
}

async function previousCalibration() {
  if (state.calibrationIndex <= 0) return;
  persistCurrentCalibration();
  try {
    await loadCalibration(state.calibrationIndex - 1, false);
  } catch (error) {
    toast(error.message, true);
  }
}

async function reloadCurrentCalibration() {
  if (!state.batchPaths.length) return;
  const button = $("#inspectButton");
  button.disabled = true;
  button.textContent = "正在读取…";
  try {
    await loadCalibration(state.calibrationIndex, true);
    toast(`已按视频第 ${$("#calibrationSecond").value} 秒重新读取本场`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    updateCalibrationControls();
  }
}

function initializeResult(result, index) {
  result.datasetIndex = index;
  result.teamNames = { blue: "", red: "" };
  result.roleMapping = {};
  result.heroNames = {};
  ["blue", "red"].forEach((team) => {
    result.players
      .filter((player) => player.team === team)
      .forEach((player, playerIndex) => {
        result.roleMapping[player.id] = "";
        result.heroNames[player.id] = `${TEAM_NAME[team]}英雄 ${playerIndex + 1}`;
      });
  });
  return result;
}

async function waitForJob(jobId, batchIndex, total) {
  while (true) {
    const job = await api(`/api/status/${jobId}`);
    const overall = Math.round(
      ((batchIndex + Number(job.progress || 0) / 100) / total) * 100,
    );
    $("#progressMessage").textContent =
      `第 ${batchIndex + 1}/${total} 场 · ${job.message}`;
    $("#progressPercent").textContent = `${overall}%`;
    $("#progressBar").style.width = `${overall}%`;
    if (job.status === "failed") throw new Error(job.message);
    if (job.status === "completed") return job.result;
    await delay(900);
  }
}

async function beginAnalysis() {
  $("#calibrationSection").classList.add("hidden");
  $("#resultsSection").classList.add("hidden");
  $("#probabilitySection").classList.add("hidden");
  $("#progressSection").classList.remove("hidden");
  setStep(3);
  state.results = [];

  const settings = {
    playbackSpeed: Number($("#playbackSpeed").value),
    gameOffset: Number($("#gameOffset").value),
    sampleSeconds: Number($("#sampleSeconds").value),
  };

  try {
    for (let index = 0; index < state.batchPaths.length; index += 1) {
      const path = state.batchPaths[index];
      $("#progressMessage").textContent =
        `第 ${index + 1}/${state.batchPaths.length} 场 · 正在准备分析`;
      const inspection = state.batchInspections[index];

      const blue = inspection.markers.filter(
        (marker) => marker.team === "blue",
      ).length;
      const red = inspection.markers.filter(
        (marker) => marker.team === "red",
      ).length;
      if (blue !== 5 || red !== 5) {
        throw new Error(
          `第 ${index + 1} 场校准数据不完整：蓝方 ${blue}/5、红方 ${red}/5`,
        );
      }

      const job = await api("/api/analyze", {
        method: "POST",
        body: JSON.stringify({
          path,
          crop: inspection.crop,
          markers: inspection.markers,
          ...settings,
          calibrationSecond: inspection.calibrationSecond,
        }),
      });
      const result = await waitForJob(job.jobId, index, state.batchPaths.length);
      state.results.push(initializeResult(result, index));
    }
    renderResults();
  } catch (error) {
    $("#progressSection").classList.add("hidden");
    $("#calibrationSection").classList.remove("hidden");
    setStep(2);
    toast(error.message, true);
  }
}

function nearestSample(samples, time) {
  if (!samples?.length) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t < time) low = middle + 1;
    else high = middle;
  }
  const after = samples[low];
  const before = samples[Math.max(0, low - 1)];
  return Math.abs(after.t - time) < Math.abs(before.t - time) ? after : before;
}

function regionName(x, y, team) {
  const px = Math.max(0, Math.min(100, Number(x)));
  const py = Math.max(0, Math.min(100, Number(y)));

  if (px >= 12 && px <= 88 && Math.abs(px + py - 100) <= 8) {
    return "中路";
  }

  const topRoad =
    (Math.abs(px - 14) <= 7 && py >= 12 && py <= 88) ||
    (Math.abs(py - 14) <= 7 && px >= 12 && px <= 88);
  if (topRoad) return "对抗路";

  const bottomRoad =
    (Math.abs(px - 86) <= 7 && py >= 12 && py <= 88) ||
    (Math.abs(py - 86) <= 7 && px >= 12 && px <= 88);
  if (bottomRoad) return "发育路";

  const dx = px - 50;
  const dy = py - 50;
  let fixedZone;
  if (Math.abs(dy) >= Math.abs(dx)) {
    fixedZone = dy < 0 ? "top" : "bottom";
  } else {
    fixedZone = dx < 0 ? "left" : "right";
  }

  const bluePerspective = {
    bottom: "己方红区",
    left: "己方蓝区",
    top: "对方红区",
    right: "对方蓝区",
  };
  const redPerspective = {
    bottom: "对方红区",
    left: "对方蓝区",
    top: "己方红区",
    right: "己方蓝区",
  };
  return (team === "blue" ? bluePerspective : redPerspective)[fixedZone];
}

function playerLabel(player, index) {
  return state.names[player.id] || `${TEAM_NAME[player.team]}英雄 ${index + 1}`;
}

function teamLabel(team) {
  return state.result?.teamNames?.[team]?.trim() || TEAM_NAME[team];
}

function resultConfigured(result) {
  if (!result?.teamNames?.blue?.trim() || !result?.teamNames?.red?.trim()) {
    return false;
  }
  return ["blue", "red"].every((team) => {
    const roles = result.players
      .filter((player) => player.team === team)
      .map((player) => result.roleMapping[player.id]);
    return (
      roles.length === 5 &&
      roles.every((role) => ROLES.includes(role)) &&
      new Set(roles).size === 5
    );
  });
}

function refreshMatchSelector() {
  const selector = $("#matchSelector");
  selector.innerHTML = "";
  state.results.forEach((result, index) => {
    const option = document.createElement("option");
    option.value = index;
    const blue = result.teamNames.blue.trim() || "蓝方待命名";
    const red = result.teamNames.red.trim() || "红方待命名";
    option.textContent = `${index + 1}. ${result.source.name} · ${blue} vs ${red}`;
    option.selected = index === state.currentResultIndex;
    selector.appendChild(option);
  });
}

function renderConfigurationStatus() {
  const complete = resultConfigured(state.result);
  const status = $("#configurationStatus");
  status.textContent = complete
    ? "本场配置完整 · 已纳入概率统计"
    : "请填写双方队名，并确保每方五个分路各出现一次";
  status.classList.toggle("complete", complete);
  refreshMatchSelector();
  renderProbabilityTable(Number($("#timeSlider").value));
}

function renderMapAt(time) {
  const layer = $("#resultMarkers");
  const list = $("#positionList");
  layer.innerHTML = "";
  list.innerHTML = "";
  $("#currentTime").textContent = formatTime(time);
  $("#frameStatus").textContent =
    `空白战术底图 · 第 ${state.currentResultIndex + 1}/${state.results.length} 场`;

  if (time > state.result.source.gameDuration) {
    list.innerHTML =
      '<div class="empty-position">当前时刻已超过本场对局时长</div>';
    renderProbabilityTable(time);
    return;
  }

  state.result.players.forEach((player, index) => {
    const point = nearestSample(player.samples, time);
    if (!point) return;
    const confidence = Number(point.confidence ?? 1);
    const sampleTolerance = Math.max(
      1,
      Number(state.result.source.sampleSeconds || 2) * 0.76,
    );
    const visible =
      confidence >= 0.5 && Math.abs(Number(point.t) - Number(time)) <= sampleTolerance;
    const area = visible ? regionName(point.x, point.y, player.team) : null;

    if (visible) {
      const marker = document.createElement("button");
      marker.className = `result-marker ${player.team} ${
        confidence < 0.72 ? "uncertain" : ""
      } ${state.forecast ? "forecast" : ""}`;
      marker.style.left = `${point.x}%`;
      marker.style.top = `${point.y}%`;
      marker.innerHTML = `<img src="${player.thumbnail}" alt="" /><span>${
        state.roles[player.id] || index + 1
      }</span>`;
      marker.title =
        `${teamLabel(player.team)} · ${playerLabel(player, index)} · ${area} · ` +
        `置信度 ${Math.round(confidence * 100)}%`;
      layer.appendChild(marker);
    }

    const row = document.createElement("div");
    row.className = `position-row ${visible ? "" : "not-visible"}`;
    row.innerHTML = `
      <i class="${player.team}"></i>
      <span>${escapeHtml(playerLabel(player, index))}<small>${escapeHtml(
        teamLabel(player.team),
      )} · ${escapeHtml(state.roles[player.id] || "未映射分路")}</small></span>
      <strong>${visible ? area : "暂未识别"}<small>${
        visible
          ? `${point.x.toFixed(1)}, ${point.y.toFixed(1)} · ${Math.round(confidence * 100)}%`
          : "头像不可见、复活中或严重重叠"
      }</small></strong>
    `;
    list.appendChild(row);
  });
  renderProbabilityTable(time);
}

function renderMappings() {
  const container = $("#playerMappings");
  container.innerHTML = "";
  ["blue", "red"].forEach((team) => {
    const block = document.createElement("section");
    block.className = "team-mapping";
    block.innerHTML = `
      <div class="team-config-head">
        <h4><i class="${team}"></i>${TEAM_NAME[team]} · 5 人</h4>
        <label>
          <span>队伍名称</span>
          <input class="team-name-input" value="${escapeHtml(
            state.result.teamNames[team],
          )}" placeholder="请输入${TEAM_NAME[team]}队名" />
        </label>
      </div>
    `;
    const teamInput = block.querySelector(".team-name-input");
    teamInput.addEventListener("input", () => {
      state.result.teamNames[team] = teamInput.value.trim();
      renderConfigurationStatus();
      renderMapAt(Number($("#timeSlider").value));
    });

    state.result.players
      .filter((player) => player.team === team)
      .forEach((player, index) => {
        const row = document.createElement("div");
        row.className = "mapping-row";
        row.innerHTML = `
          <img src="${player.thumbnail}" alt="英雄头像" />
          <input value="${escapeHtml(
            state.names[player.id],
          )}" aria-label="英雄名称" />
          <select aria-label="分路">
            <option value="" disabled ${
              state.roles[player.id] ? "" : "selected"
            }>选择分路</option>
            ${ROLES.map(
              (role) =>
                `<option ${
                  state.roles[player.id] === role ? "selected" : ""
                }>${role}</option>`,
            ).join("")}
          </select>
        `;
        const input = row.querySelector("input");
        const select = row.querySelector("select");
        input.addEventListener("input", () => {
          state.names[player.id] =
            input.value.trim() || `${TEAM_NAME[team]}英雄 ${index + 1}`;
          renderMapAt(Number($("#timeSlider").value));
        });
        select.addEventListener("change", () => {
          state.roles[player.id] = select.value;
          renderConfigurationStatus();
          renderMapAt(Number($("#timeSlider").value));
        });
        block.appendChild(row);
      });
    container.appendChild(block);
  });
  renderConfigurationStatus();
}

function selectResult(index, preserveTime = true) {
  state.currentResultIndex = Math.max(
    0,
    Math.min(Number(index) || 0, state.results.length - 1),
  );
  state.result = state.results[state.currentResultIndex];
  state.roles = state.result.roleMapping;
  state.names = state.result.heroNames;
  $("#matchSelector").value = String(state.currentResultIndex);
  if (!preserveTime) $("#timeSlider").value = Math.min(60, maxDatasetDuration());
  renderMappings();
  renderMapAt(Number($("#timeSlider").value));
}

function maxDatasetDuration() {
  return Math.floor(
    Math.max(0, ...state.results.map((result) => result.source.gameDuration)),
  );
}

function renderResults() {
  $("#progressSection").classList.add("hidden");
  $("#resultsSection").classList.remove("hidden");
  $("#probabilitySection").classList.remove("hidden");
  state.currentResultIndex = 0;
  const duration = maxDatasetDuration();
  $("#timeSlider").max = duration;
  $("#timeSlider").value = Math.min(duration, 60);
  $("#forecastTime").max = duration;
  $("#forecastTime").value = Math.min(duration, 600);
  $("#durationTime").textContent = formatTime(duration);
  refreshMatchSelector();
  selectResult(0, true);
  setStep(4);
  toast(
    `${state.results.length} 场轨迹已生成，请逐场填写队名并核对英雄分路`,
  );
}

function aggregateAt(time) {
  const groups = new Map();
  state.results.filter(resultConfigured).forEach((result) => {
    if (time < 0 || time > result.source.gameDuration) return;
    result.players.forEach((player) => {
      const point = nearestSample(player.samples, time);
      if (!point || Number(point.confidence ?? 0) < 0.5) return;
      const tolerance = Math.max(
        1,
        Number(result.source.sampleSeconds || 2) * 0.76,
      );
      if (Math.abs(Number(point.t) - Number(time)) > tolerance) return;
      const team = result.teamNames[player.team].trim();
      const role = result.roleMapping[player.id];
      if (!team || !role) return;
      const key = `${team}\u0000${role}`;
      if (!groups.has(key)) {
        groups.set(key, {
          team,
          role,
          total: 0,
          counts: Object.fromEntries(REGIONS.map((region) => [region, 0])),
        });
      }
      const group = groups.get(key);
      const region = regionName(point.x, point.y, player.team);
      group.total += 1;
      group.counts[region] += 1;
    });
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      probabilities: Object.fromEntries(
        REGIONS.map((region) => [
          region,
          group.total ? group.counts[region] / group.total : 0,
        ]),
      ),
    }))
    .sort(
      (a, b) =>
        a.team.localeCompare(b.team, "zh-CN") ||
        ROLES.indexOf(a.role) - ROLES.indexOf(b.role),
    );
}

function renderProbabilityTable(time) {
  if (!state.results.length) return;
  const table = $("#probabilityTable");
  const rows = aggregateAt(time);
  const configured = state.results.filter(resultConfigured).length;
  $("#probabilityMeta").textContent =
    `${formatTime(time)} · 已纳入 ${configured}/${state.results.length} 场`;
  table.querySelector("thead").innerHTML = `
    <tr>
      <th>队伍</th>
      <th>分路</th>
      <th>有效场次</th>
      ${REGIONS.map((region) => `<th>${region}</th>`).join("")}
    </tr>
  `;
  if (!rows.length) {
    table.querySelector("tbody").innerHTML = `
      <tr><td colspan="${REGIONS.length + 3}" class="empty-table">
        请先逐场填写双方队名并确保每方五个分路不重复
      </td></tr>
    `;
    return;
  }
  table.querySelector("tbody").innerHTML = rows
    .map((row) => {
      const maximum = Math.max(...Object.values(row.probabilities));
      return `
        <tr>
          <td>${escapeHtml(row.team)}</td>
          <td>${escapeHtml(row.role)}</td>
          <td>${row.total}</td>
          ${REGIONS.map((region) => {
            const probability = row.probabilities[region];
            return `<td class="${
              probability === maximum && probability > 0 ? "probability-peak" : ""
            }">${(probability * 100).toFixed(1)}%</td>`;
          }).join("")}
        </tr>
      `;
    })
    .join("");
}

function probabilitySeries() {
  const configured = state.results.filter(resultConfigured);
  if (!configured.length) return [];
  const step = Math.max(
    1,
    Math.min(
      ...configured.map((result) => Number(result.source.sampleSeconds || 2)),
    ),
  );
  const maximum = Math.floor(
    Math.max(...configured.map((result) => result.source.gameDuration)),
  );
  const rows = [];
  for (let time = 0; time <= maximum; time += step) {
    aggregateAt(time).forEach((row) => rows.push({ time, ...row }));
  }
  return rows;
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function resultForExport(result) {
  const { background, ...rest } = result;
  return rest;
}

function downloadResult() {
  if (!state.results.length) return;
  const payload = {
    version: 2,
    createdAt: new Date().toISOString(),
    regionDefinition: {
      regions: REGIONS,
      bluePerspective: {
        bottom: "己方红区",
        left: "己方蓝区",
        top: "对方红区",
        right: "对方蓝区",
      },
      redPerspective: {
        bottom: "对方红区",
        left: "对方蓝区",
        top: "己方红区",
        right: "己方蓝区",
      },
      lanePriority: ["对抗路", "中路", "发育路"],
    },
    matches: state.results.map(resultForExport),
    probabilitySeries: probabilitySeries().map((row) => ({
      time: row.time,
      team: row.team,
      role: row.role,
      validMatches: row.total,
      probabilities: row.probabilities,
    })),
  };
  downloadBlob(
    JSON.stringify(payload, null, 2),
    "application/json",
    `KPL-批量轨迹与概率-${Date.now()}.json`,
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadProbability() {
  const series = probabilitySeries();
  if (!series.length) {
    toast("请先完成至少一场对局的队名与分路配置", true);
    return;
  }
  const header = ["时间秒", "时间", "队伍", "分路", "有效场次", ...REGIONS];
  const lines = [header.map(csvCell).join(",")];
  series.forEach((row) => {
    lines.push(
      [
        row.time,
        formatTime(row.time),
        row.team,
        row.role,
        row.total,
        ...REGIONS.map((region) =>
          (row.probabilities[region] * 100).toFixed(2),
        ),
      ]
        .map(csvCell)
        .join(","),
    );
  });
  downloadBlob(
    `\ufeff${lines.join("\r\n")}`,
    "text/csv;charset=utf-8",
    `KPL-全时间点区域概率-${Date.now()}.csv`,
  );
}

function togglePlayback() {
  state.playing = !state.playing;
  $("#playButton").textContent = state.playing ? "Ⅱ" : "▶";
  if (!state.playing) return;
  const tick = () => {
    if (!state.playing) return;
    const slider = $("#timeSlider");
    let next = Number(slider.value) + 2;
    if (next > Number(slider.max)) {
      next = 0;
      state.playing = false;
      $("#playButton").textContent = "▶";
    }
    slider.value = next;
    state.forecast = false;
    renderMapAt(next);
    if (state.playing) window.setTimeout(tick, 300);
  };
  tick();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const defaults = await api("/api/defaults");
    $("#videoPaths").value = defaults.videoPath;
  } catch {
    $("#videoPaths").value = "";
  }

  $("#inspectButton").addEventListener("click", () => {
    if (state.batchPaths.length) {
      reloadCurrentCalibration();
    } else {
      inspectVideo();
    }
  });
  $("#videoPaths").addEventListener("input", () => {
    state.batchPaths = [];
    state.batchInspections = [];
    state.calibrationIndex = 0;
    $("#confirmCalibration").checked = false;
    updateMarkerCount();
  });
  $("#calibrationSecond").addEventListener("input", () => {
    if (!state.batchPaths.length) return;
    state.calibrationSecondDirty = true;
    $("#confirmCalibration").checked = false;
    updateMarkerCount();
  });
  $("#confirmCalibration").addEventListener("change", updateMarkerCount);
  $("#previousCalibrationButton").addEventListener(
    "click",
    previousCalibration,
  );
  $("#analyzeButton").addEventListener("click", advanceCalibration);
  $("#downloadButton").addEventListener("click", downloadResult);
  $("#downloadProbabilityButton").addEventListener(
    "click",
    downloadProbability,
  );
  $("#matchSelector").addEventListener("change", (event) => {
    selectResult(Number(event.target.value), true);
  });
  $("#playButton").addEventListener("click", togglePlayback);
  $("#timeSlider").addEventListener("input", (event) => {
    state.forecast = false;
    renderMapAt(Number(event.target.value));
  });
  $("#forecastButton").addEventListener("click", () => {
    if (!state.result) return;
    const target = Math.max(
      0,
      Math.min(Number($("#forecastTime").value), maxDatasetDuration()),
    );
    state.forecast = true;
    $("#timeSlider").value = target;
    renderMapAt(target);
    toast(`已刷新 ${formatTime(target)} 的跨场区域概率`);
  });

  document.querySelectorAll(".team-toggle button").forEach((button) => {
    button.addEventListener("click", () => {
      state.addTeam = button.dataset.team;
      document
        .querySelectorAll(".team-toggle button")
        .forEach((item) => item.classList.toggle("active", item === button));
    });
  });

  $("#previewWrap").addEventListener("click", (event) => {
    if (!state.info) return;
    const teamCount = state.markers.filter(
      (marker) => marker.team === state.addTeam,
    ).length;
    if (teamCount >= 5) {
      toast(`${TEAM_NAME[state.addTeam]}已经有 5 个标记`, true);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    state.markers.push({
      id: `${state.addTeam}-${Date.now()}`,
      team: state.addTeam,
      x: ((event.clientX - rect.left) / rect.width) * state.info.mapWidth,
      y: ((event.clientY - rect.top) / rect.height) * state.info.mapHeight,
      r: 46,
      confidence: 1,
    });
    $("#confirmCalibration").checked = false;
    renderCalibrationMarkers();
  });
});
