"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Role = "对抗路" | "打野" | "中单" | "发育路" | "辅助";
type Team = "blue" | "red";
type Point = { t: number; x: number; y: number };
type Player = {
  id: string;
  team: Team;
  role: Role;
  name: string;
  short: string;
};
type TrackMap = Record<string, Point[]>;

const ROLES: Role[] = ["对抗路", "打野", "中单", "发育路", "辅助"];
const ROLE_SHORT: Record<Role, string> = {
  对抗路: "对",
  打野: "野",
  中单: "中",
  发育路: "发",
  辅助: "辅",
};

const PLAYERS: Player[] = [
  { id: "b-clash", team: "blue", role: "对抗路", name: "轻语", short: "QY" },
  { id: "b-jungle", team: "blue", role: "打野", name: "今屿", short: "JY" },
  { id: "b-mid", team: "blue", role: "中单", name: "流浪", short: "LW" },
  { id: "b-farm", team: "blue", role: "发育路", name: "妖刀", short: "YD" },
  { id: "b-roam", team: "blue", role: "辅助", name: "久酷", short: "JK" },
  { id: "r-clash", team: "red", role: "对抗路", name: "轩染", short: "XR" },
  { id: "r-jungle", team: "red", role: "打野", name: "钟意", short: "ZY" },
  { id: "r-mid", team: "red", role: "中单", name: "长生", short: "CS" },
  { id: "r-farm", team: "red", role: "发育路", name: "一诺", short: "YN" },
  { id: "r-roam", team: "red", role: "辅助", name: "大帅", short: "DS" },
];

const PATHS: Record<Role, [number, number][]> = {
  对抗路: [
    [10, 84],
    [18, 58],
    [17, 24],
    [38, 19],
    [65, 18],
    [76, 28],
  ],
  打野: [
    [13, 84],
    [25, 71],
    [34, 57],
    [46, 48],
    [59, 42],
    [70, 28],
  ],
  中单: [
    [11, 87],
    [29, 70],
    [42, 58],
    [53, 48],
    [65, 37],
    [78, 24],
  ],
  发育路: [
    [15, 90],
    [41, 84],
    [70, 81],
    [82, 66],
    [81, 40],
    [76, 28],
  ],
  辅助: [
    [13, 88],
    [34, 81],
    [42, 62],
    [51, 51],
    [67, 45],
    [75, 29],
  ],
};

function clamp(value: number, min = 4, max = 96) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(
    Math.floor(seconds % 60),
  ).padStart(2, "0")}`;
}

function generatedPosition(player: Player, time: number): Point {
  const basePath = PATHS[player.role];
  const phase = Math.min(basePath.length - 1.001, time / 205);
  const index = Math.floor(phase);
  const mix = phase - index;
  const from = basePath[index];
  const to = basePath[Math.min(index + 1, basePath.length - 1)];
  const roleIndex = ROLES.indexOf(player.role);
  let x = from[0] + (to[0] - from[0]) * mix;
  let y = from[1] + (to[1] - from[1]) * mix;

  const roam = Math.sin(time / (41 + roleIndex * 3) + roleIndex) * (1.2 + roleIndex * 0.2);
  x += roam;
  y += Math.cos(time / (54 + roleIndex * 2) + roleIndex) * 1.4;

  if (player.team === "red") {
    x = 100 - x;
    y = 100 - y;
  }
  return { t: time, x: clamp(x), y: clamp(y) };
}

function nearestPoint(points: Point[], time: number) {
  if (!points.length) return null;
  let winner = points[0];
  let distance = Math.abs(points[0].t - time);
  for (const point of points) {
    const nextDistance = Math.abs(point.t - time);
    if (nextDistance < distance) {
      winner = point;
      distance = nextDistance;
    }
  }
  return winner;
}

function areaName(x: number, y: number) {
  if (x < 22 && y > 72) return "蓝方基地";
  if (x > 78 && y < 28) return "红方基地";
  if (Math.abs(x - y) < 10) return "中轴河道";
  if (y < 28) return "对抗路";
  if (y > 72) return "发育路";
  if (x > 41 && x < 59 && y > 38 && y < 62) return "河道中心";
  if ((x < 50 && y < 50) || (x > 50 && y > 50)) return "上半野区";
  return "下半野区";
}

function parseCsv(raw: string) {
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((item) => item.trim().toLowerCase());
  const indexes = {
    time: header.indexOf("time"),
    team: header.indexOf("team"),
    role: header.indexOf("role"),
    player: header.indexOf("player"),
    x: header.indexOf("x"),
    y: header.indexOf("y"),
  };
  if (Object.values(indexes).some((value) => value < 0)) {
    throw new Error("CSV 表头需要包含 time, team, role, player, x, y");
  }
  const tracks: TrackMap = {};
  const playerMap = new Map<string, Player>();
  for (const line of lines.slice(1)) {
    const values = line.split(",").map((item) => item.trim());
    const role = values[indexes.role] as Role;
    const team = values[indexes.team].toLowerCase() === "red" ? "red" : "blue";
    if (!ROLES.includes(role)) continue;
    const id = `${team}-${role}`;
    const name = values[indexes.player] || role;
    playerMap.set(id, { id, team, role, name, short: name.slice(0, 2) });
    tracks[id] ??= [];
    tracks[id].push({
      t: Number(values[indexes.time]),
      x: Number(values[indexes.x]),
      y: Number(values[indexes.y]),
    });
  }
  return { tracks, players: Array.from(playerMap.values()) };
}

export default function Home() {
  const [currentTime, setCurrentTime] = useState(452);
  const [predictionTime, setPredictionTime] = useState(750);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState("b-jungle");
  const [sideFilter, setSideFilter] = useState<"all" | Team>("all");
  const [rightTab, setRightTab] = useState<"positions" | "forecast">("positions");
  const [showPrediction, setShowPrediction] = useState(false);
  const [tracks, setTracks] = useState<TrackMap>({});
  const [players, setPlayers] = useState<Player[]>(PLAYERS);
  const [duration, setDuration] = useState(1080);
  const [sourceName, setSourceName] = useState("2026 春季赛 · 示例数据");
  const [importMessage, setImportMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        if (time >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return Math.min(duration, time + 5);
      });
    }, 450);
    return () => window.clearInterval(timer);
  }, [duration, isPlaying]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT") return;
      event.preventDefault();
      setCurrentTime((time) =>
        clamp(time + (event.key === "ArrowRight" ? 5 : -5), 0, duration),
      );
      setIsPlaying(false);
      setShowPrediction(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [duration]);

  useEffect(() => {
    const earliest = Math.min(duration, currentTime + 10);
    setPredictionTime((time) => Math.min(duration, Math.max(earliest, time)));
  }, [currentTime, duration]);

  const positions = useMemo(
    () =>
      players.map((player) => {
        const observed = tracks[player.id]?.length
          ? nearestPoint(tracks[player.id], currentTime)
          : generatedPosition(player, currentTime);
        return { player, point: observed ?? generatedPosition(player, currentTime) };
      }),
    [currentTime, players, tracks],
  );

  const predictions = useMemo(
    () =>
      players.map((player, playerIndex) => {
        const samples = tracks[player.id] ?? [];
        let point = generatedPosition(player, predictionTime);
        let confidence = 84 - Math.abs(predictionTime - currentTime) / 42 - (playerIndex % 4) * 2;
        if (samples.length >= 2) {
          const recent = [...samples].sort((a, b) => a.t - b.t).filter((p) => p.t <= currentTime);
          const last = recent.at(-1) ?? samples[0];
          const previous = recent.at(-2) ?? last;
          const delta = Math.max(1, last.t - previous.t);
          const horizon = Math.min(90, Math.max(0, predictionTime - last.t));
          const decay = Math.exp(-horizon / 85);
          point = {
            t: predictionTime,
            x: clamp(last.x + ((last.x - previous.x) / delta) * horizon * decay),
            y: clamp(last.y + ((last.y - previous.y) / delta) * horizon * decay),
          };
          confidence = 88 - horizon * 0.22;
        }
        return {
          player,
          point,
          confidence: Math.round(clamp(confidence, 52, 94)),
        };
      }),
    [currentTime, players, predictionTime, tracks],
  );

  const mapPoints = showPrediction && rightTab === "forecast" ? predictions : positions;
  const selected =
    mapPoints.find((item) => item.player.id === selectedId) ?? mapPoints[0];

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      let nextTracks: TrackMap = {};
      let nextPlayers: Player[] = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = parseCsv(raw);
        nextTracks = parsed.tracks;
        nextPlayers = parsed.players;
      } else {
        const parsed = JSON.parse(raw);
        const rawPlayers = Array.isArray(parsed.players) ? parsed.players : [];
        nextPlayers = rawPlayers.map((item: Player & { samples?: Point[] }, index: number) => {
          const player = {
            id: item.id || `${item.team}-${item.role}-${index}`,
            team: item.team === "red" ? "red" as const : "blue" as const,
            role: item.role,
            name: item.name || item.role,
            short: item.short || (item.name || item.role).slice(0, 2),
          };
          nextTracks[player.id] = item.samples ?? [];
          return player;
        });
      }
      if (!nextPlayers.length || !Object.keys(nextTracks).length) {
        throw new Error("没有识别到有效的选手轨迹");
      }
      const maxTime = Math.max(
        ...Object.values(nextTracks).flat().map((point) => Number(point.t) || 0),
      );
      setTracks(nextTracks);
      setPlayers(nextPlayers);
      setDuration(Math.max(60, maxTime));
      setCurrentTime(Math.min(60, maxTime));
      setPredictionTime(Math.min(maxTime, Math.max(90, maxTime * 0.7)));
      setSelectedId(nextPlayers[0].id);
      setSourceName(file.name);
      setImportMessage(`已载入 ${nextPlayers.length} 名选手、${Object.values(nextTracks).flat().length} 个坐标点`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "文件解析失败");
    } finally {
      event.target.value = "";
    }
  }

  function resetDemo() {
    setTracks({});
    setPlayers(PLAYERS);
    setDuration(1080);
    setCurrentTime(452);
    setPredictionTime(750);
    setSourceName("2026 春季赛 · 示例数据");
    setImportMessage("已恢复内置示例对局");
    setSelectedId("b-jungle");
  }

  return (
    <main className="app-shell">
      <aside className="left-rail">
        <div className="brand">
          <div className="brand-mark">∴</div>
          <div>
            <div className="eyebrow">KPL SPATIAL LAB</div>
            <h1>战术罗盘</h1>
          </div>
          <span className="beta">BETA</span>
        </div>

        <section className="rail-section">
          <div className="section-label">当前对局</div>
          <article className="match-card active-match">
            <div className="match-meta">
              <span>BO7 · 第 6 局</span>
              <span className="live-dot">演示</span>
            </div>
            <div className="team-line">
              <span className="team-swatch blue" />
              <strong>苏州 KSG</strong>
              <b>3</b>
            </div>
            <div className="team-line">
              <span className="team-swatch red" />
              <strong>成都 AG</strong>
              <b>2</b>
            </div>
            <div className="match-footer">{sourceName}</div>
          </article>
        </section>

        <section className="rail-section history">
          <div className="section-heading">
            <span className="section-label">对局库</span>
            <button className="text-button" onClick={resetDemo}>恢复示例</button>
          </div>
          <button className="history-row">
            <span><i className="status-dot ready" />KSG vs AG</span>
            <small>18:00</small>
          </button>
          <button className="history-row muted">
            <span><i className="status-dot" />DRG vs 狼队</span>
            <small>待导入</small>
          </button>
          <button className="history-row muted">
            <span><i className="status-dot" />WB vs TTG</span>
            <small>待导入</small>
          </button>
        </section>

        <section className="import-zone">
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept=".json,.csv"
            onChange={handleImport}
          />
          <button className="import-button" onClick={() => fileRef.current?.click()}>
            <span className="import-icon">↥</span>
            <span>
              <strong>导入轨迹数据</strong>
              <small>JSON / CSV · 归一化坐标</small>
            </span>
          </button>
          {importMessage && <p className="import-message">{importMessage}</p>}
          <details className="format-help">
            <summary>查看数据格式</summary>
            <code>time,team,role,player,x,y</code>
            <p>team 使用 blue / red；x、y 为 0–100。</p>
          </details>
        </section>

        <div className="rail-bottom">
          <div className="quality-row">
            <span>轨迹完整度</span>
            <strong>{tracks && Object.keys(tracks).length ? "已导入" : "96.8%"}</strong>
          </div>
          <div className="quality-bar"><i /></div>
          <p>采样间隔 1s · 坐标已映射</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="breadcrumb">对局分析 <span>/</span> KSG vs AG <span>/</span> 第 6 局</div>
            <div className="top-title">
              <h2>全场空间态势</h2>
              <span className="data-status"><i /> 数据就绪</span>
            </div>
          </div>
          <div className="top-actions">
            <div className="segmented" aria-label="队伍筛选">
              {(["all", "blue", "red"] as const).map((item) => (
                <button
                  key={item}
                  className={sideFilter === item ? "active" : ""}
                  onClick={() => setSideFilter(item)}
                >
                  {item === "all" ? "双方" : item === "blue" ? "蓝方" : "红方"}
                </button>
              ))}
            </div>
            <button className="icon-button" title="导出当前视图">⇩</button>
          </div>
        </header>

        <div className="analysis-stage">
          <div className="map-column">
            <div className="map-meta">
              <div>
                <span className="mode-label">
                  {showPrediction && rightTab === "forecast" ? "预测态势" : "历史观测"}
                </span>
                <strong>
                  {formatTime(showPrediction && rightTab === "forecast" ? predictionTime : currentTime)}
                </strong>
              </div>
              <div className="legend">
                <span><i className="legend-dot blue" /> 蓝方</span>
                <span><i className="legend-dot red" /> 红方</span>
                {showPrediction && rightTab === "forecast" && <span><i className="legend-ring" /> 预测点</span>}
              </div>
            </div>

            <div className={`battle-map ${showPrediction && rightTab === "forecast" ? "forecasting" : ""}`}>
              <div className="map-grid" />
              <div className="lane lane-main" />
              <div className="lane lane-top" />
              <div className="lane lane-bottom" />
              <div className="river" />
              <div className="base blue-base"><span>蓝</span></div>
              <div className="base red-base"><span>红</span></div>
              <div className="objective tyrant">暴君</div>
              <div className="objective overlord">主宰</div>
              <div className="map-label label-top">对抗路</div>
              <div className="map-label label-mid">中路</div>
              <div className="map-label label-bottom">发育路</div>
              <div className="brush brush-a" />
              <div className="brush brush-b" />
              <div className="brush brush-c" />
              <div className="brush brush-d" />
              {mapPoints.map((item) => {
                const visible = sideFilter === "all" || item.player.team === sideFilter;
                const isSelected = item.player.id === selectedId;
                return (
                  <button
                    key={item.player.id}
                    className={`player-marker ${item.player.team} ${isSelected ? "selected" : ""} ${visible ? "" : "hidden-team"}`}
                    style={{ left: `${item.point.x}%`, top: `${item.point.y}%` }}
                    onClick={() => setSelectedId(item.player.id)}
                    aria-label={`${item.player.name} ${item.player.role}`}
                  >
                    <span>{ROLE_SHORT[item.player.role]}</span>
                    <small>{item.player.name}</small>
                  </button>
                );
              })}
              {selected && (
                <div
                  className="selection-info"
                  style={{
                    left: `${Math.min(74, selected.point.x + 3)}%`,
                    top: `${Math.min(82, selected.point.y + 4)}%`,
                  }}
                >
                  <strong>{selected.player.name} · {selected.player.role}</strong>
                  <span>{areaName(selected.point.x, selected.point.y)}</span>
                  <code>{selected.point.x.toFixed(1)}, {selected.point.y.toFixed(1)}</code>
                </div>
              )}
            </div>

            <section className="timeline-panel">
              <div className="timeline-controls">
                <button
                  className="play-button"
                  onClick={() => setIsPlaying((value) => !value)}
                  aria-label={isPlaying ? "暂停" : "播放"}
                >
                  {isPlaying ? "Ⅱ" : "▶"}
                </button>
                <div className="time-display">{formatTime(currentTime)}</div>
                <input
                  aria-label="对局时间轴"
                  type="range"
                  min="0"
                  max={duration}
                  value={currentTime}
                  onChange={(event) => {
                    setCurrentTime(Number(event.target.value));
                    setIsPlaying(false);
                    setShowPrediction(false);
                  }}
                  style={{ "--progress": `${(currentTime / duration) * 100}%` } as React.CSSProperties}
                />
                <span className="duration">{formatTime(duration)}</span>
              </div>
              <div className="event-track">
                <i style={{ left: "11%" }}><span>首个暴君</span></i>
                <i style={{ left: "29%" }}><span>蓝方团战</span></i>
                <i style={{ left: "52%" }}><span>主宰击杀</span></i>
                <i style={{ left: "78%" }}><span>高地推进</span></i>
              </div>
              <div className="timeline-hint">
                <span>拖动时间轴查询任意时刻</span>
                <span>← / → 每次移动 5 秒</span>
              </div>
            </section>
          </div>

          <aside className="right-panel">
            <div className="panel-tabs">
              <button
                className={rightTab === "positions" ? "active" : ""}
                onClick={() => {
                  setRightTab("positions");
                  setShowPrediction(false);
                }}
              >
                位置清单
              </button>
              <button
                className={rightTab === "forecast" ? "active" : ""}
                onClick={() => setRightTab("forecast")}
              >
                预测分析
              </button>
            </div>

            {rightTab === "positions" ? (
              <>
                <div className="panel-heading">
                  <div>
                    <span>查询时刻</span>
                    <strong>{formatTime(currentTime)}</strong>
                  </div>
                  <button onClick={() => setCurrentTime(0)}>回到开局</button>
                </div>
                <div className="position-list">
                  {(["blue", "red"] as Team[]).map((team) => (
                    <div className="team-block" key={team}>
                      <div className="team-block-title">
                        <span><i className={`team-swatch ${team}`} />{team === "blue" ? "苏州 KSG" : "成都 AG"}</span>
                        <small>{team === "blue" ? "蓝方" : "红方"}</small>
                      </div>
                      {positions.filter((item) => item.player.team === team).map((item) => (
                        <button
                          className={`position-row ${selectedId === item.player.id ? "active" : ""}`}
                          key={item.player.id}
                          onClick={() => setSelectedId(item.player.id)}
                        >
                          <span className={`role-box ${team}`}>{ROLE_SHORT[item.player.role]}</span>
                          <span className="player-copy">
                            <strong>{item.player.name}</strong>
                            <small>{item.player.role}</small>
                          </span>
                          <span className="location-copy">
                            <strong>{areaName(item.point.x, item.point.y)}</strong>
                            <small>X {item.point.x.toFixed(1)} · Y {item.point.y.toFixed(1)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="forecast-panel">
                <div className="forecast-intro">
                  <span className="forecast-kicker">NEXT-MOMENT FORECAST</span>
                  <h3>指定时刻位置预测</h3>
                  <p>利用已观测轨迹、分路先验与相似回合，推演十名选手的区域落点。</p>
                </div>
                <div className="forecast-time">
                  <label>
                    <span>目标时刻</span>
                    <strong>{formatTime(predictionTime)}</strong>
                  </label>
                  <input
                    type="range"
                    min={Math.min(duration, currentTime + 10)}
                    max={duration}
                    value={predictionTime}
                    onChange={(event) => {
                      setPredictionTime(Number(event.target.value));
                      setShowPrediction(false);
                    }}
                    style={{ "--progress": `${(predictionTime / duration) * 100}%` } as React.CSSProperties}
                  />
                  <div><span>{formatTime(Math.min(duration, currentTime + 10))}</span><span>{formatTime(duration)}</span></div>
                </div>
                <button className="forecast-button" onClick={() => setShowPrediction(true)}>
                  <span>✦</span>
                  {showPrediction ? "重新生成预测" : "生成位置预测"}
                </button>
                {showPrediction && (
                  <div className="forecast-results">
                    <div className="result-summary">
                      <span>预测已生成</span>
                      <strong>平均置信度 {Math.round(predictions.reduce((sum, item) => sum + item.confidence, 0) / predictions.length)}%</strong>
                    </div>
                    {predictions.map((item) => (
                      <button
                        key={item.player.id}
                        className="forecast-row"
                        onClick={() => setSelectedId(item.player.id)}
                      >
                        <i className={item.player.team} />
                        <span>{item.player.name}</span>
                        <strong>{areaName(item.point.x, item.point.y)}</strong>
                        <small>{item.confidence}%</small>
                      </button>
                    ))}
                  </div>
                )}
                <div className="model-note">
                  <span>模型说明</span>
                  <p>当前原型使用分路轨迹先验与短时速度衰减。接入多场真实标注后，可替换为时空 Transformer 或图神经网络。</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
