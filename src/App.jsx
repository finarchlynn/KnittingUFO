import React, { useState, useEffect, useRef, useMemo } from "react";

// ─── 디자인 토큰 (뜨개/실 작업실 무드: 오트밀 종이 + 인디고 + 매더 베리) ───
const C = {
  bg: "#E9E3D8",
  card: "#FBF8F2",
  cardAlt: "#F4EFE5",
  ink: "#2C2724",
  sub: "#8A8076",
  line: "#DAD0C0",
  indigo: "#3B4A6B",
  indigoDk: "#2A3650",
  berry: "#A23B52",
};
const STATUS = {
  "찜한 도안": { c: "#4F7A4D", bg: "#E2EDE1" },
  계획: { c: "#8A8076", bg: "#EFEAE0" },
  진행중: { c: "#3B4A6B", bg: "#E4E7EF" },
  완성: { c: "#A26A2E", bg: "#F2E8D8" },
};
const STATUS_ORDER = ["찜한 도안", "계획", "진행중", "완성"];
const CATEGORIES = ["반팔스웨터", "긴팔스웨터", "가디건", "베스트", "의류소품", "가방소품", "키즈", "기타"];
const SEASONS = ["봄가을", "여름", "겨울", "사계절"];
const FACETS = [["유형", "category"], ["계절", "season"], ["바늘", "needle"], ["도안작가", "designer"]];
const IDX = "kp:index";
const SET = "kp:settings";
const P = (id) => `kp:p:${id}`;
const MAX_PHOTOS = 12;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtDate = (s) => s || "—";

// ─── 저장소 (IndexedDB) ───
const DB_NAME = "knit-tracker";
const STORE = "kv";
let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}
function idbReq(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const r = fn(store);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function getKey(k) {
  try { const v = await idbReq("readonly", (s) => s.get(k)); return v ? JSON.parse(v) : null; }
  catch { return null; }
}
async function setKey(k, v) {
  try { await idbReq("readwrite", (s) => s.put(JSON.stringify(v), k)); return true; }
  catch (e) { console.error("저장 실패", k, e); return false; }
}
async function delKey(k) { try { await idbReq("readwrite", (s) => s.delete(k)); } catch {} }

// ─── 이미지 축소 ───
function fileToDataUrl(file, maxDim, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function shrinkDataUrl(dataUrl, maxDim, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ─── 외부 라이브러리 (PDF) ───
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("라이브러리 로드 실패"));
    document.head.appendChild(s);
  });
}
async function ensurePdfLibs() {
  if (!window.html2canvas) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
}
async function exportPdf(node, filename) {
  await ensurePdfLibs();
  const canvas = await window.html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");
  const pageW = 210, pageH = 297;
  const imgW = pageW, imgH = (canvas.height * imgW) / canvas.width;
  const imgData = canvas.toDataURL("image/jpeg", 0.92);
  let heightLeft = imgH, position = 0;
  pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) { position = heightLeft - imgH; pdf.addPage(); pdf.addImage(imgData, "JPEG", 0, position, imgW, imgH); heightLeft -= pageH; }
  pdf.save(`${filename}.pdf`);
}

function downloadCsv(projects, sheetName) {
  const header = ["프로젝트명", "유형", "계절", "상태", "도안", "도안작가", "도안출처", "바늘", "실", "실사용량", "게이지", "사이즈", "시작일", "완성일", "메모"];
  const esc = (x) => `"${String(x || "").replace(/"/g, '""')}"`;
  const lines = [header.map(esc).join(",")];
  projects.forEach((p) => lines.push([p.name, p.category, p.season, p.status, p.patternName, p.designer, p.patternSource, p.needle, p.yarn, p.yarnAmount, p.gauge, p.size, p.startDate, p.doneDate, p.notes].map(esc).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sheetName}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const blank = () => ({ id: uid(), name: "", status: "찜한 도안", category: "", season: "", designer: "", patternName: "", patternSource: "", needle: "", yarn: "", yarnAmount: "", gauge: "", size: "", startDate: "", doneDate: "", notes: "", photos: [], updatedAt: Date.now() });

// ─── 메인 ───
export default function KnitTracker() {
  const [index, setIndex] = useState(null);
  const [settings, setSettings] = useState({ sheetName: "뜨개프로젝트" });
  const [view, setView] = useState({ name: "list" }); // {name:'list'} | {name:'detail',id} | {name:'settings'}
  const [filters, setFilters] = useState({ status: "전체", category: "전체", season: "전체", needle: "전체", designer: "전체" });

  useEffect(() => {
    (async () => {
      setIndex((await getKey(IDX)) || []);
      const s = await getKey(SET); if (s) setSettings(s);
    })();
  }, []);

  const refreshIndex = async () => setIndex((await getKey(IDX)) || []);

  const saveProject = async (proj) => {
    const next = { ...proj, updatedAt: Date.now() };
    await setKey(P(next.id), next);
    const thumb = next.photos[0] ? await shrinkDataUrl(next.photos[0], 240) : null;
    const meta = { id: next.id, name: next.name || "제목 없음", status: next.status, category: next.category, season: next.season, designer: next.designer, needle: next.needle, yarn: next.yarn, photoCount: next.photos.length, thumb, updatedAt: next.updatedAt };
    const cur = (await getKey(IDX)) || [];
    const i = cur.findIndex((m) => m.id === next.id);
    if (i >= 0) cur[i] = meta; else cur.unshift(meta);
    await setKey(IDX, cur);
    await refreshIndex();
  };
  const deleteProject = async (id) => {
    await delKey(P(id));
    const cur = ((await getKey(IDX)) || []).filter((m) => m.id !== id);
    await setKey(IDX, cur);
    await refreshIndex();
  };
  const saveSettings = async (s) => { setSettings(s); await setKey(SET, s); };

  if (index === null) {
    return <div style={wrapStyle("center")}>불러오는 중…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Apple SD Gothic Neo','Pretendard','Malgun Gothic',sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        button { cursor: pointer; font-family: inherit; }
        input, select, textarea { font-family: inherit; }
        .mono { font-family: ui-monospace,'SF Mono',Menlo,monospace; font-variant-numeric: tabular-nums; }
        .card { background:${C.card}; border:1px solid ${C.line}; border-radius:14px; }
        .fld { width:100%; padding:10px 12px; border:1.5px solid ${C.line}; border-radius:9px; font-size:14px; background:#fff; outline:none; }
        .fld:focus { border-color:${C.indigo}; }
        .lbl { font-size:11.5px; font-weight:700; color:${C.sub}; margin-bottom:5px; letter-spacing:.02em; }
        @media (prefers-reduced-motion: reduce){ *{transition:none!important} }
      `}</style>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 14px 40px" }}>
        {view.name === "list" && (
          <ListView index={index} filters={filters} setFilters={setFilters}
            onOpen={(id) => setView({ name: "detail", id })}
            onNew={() => setView({ name: "detail", id: "new" })}
            onSettings={() => setView({ name: "settings" })} />
        )}
        {view.name === "detail" && (
          <DetailView id={view.id} onSave={saveProject} onDelete={deleteProject} onBack={() => setView({ name: "list" })} />
        )}
        {view.name === "settings" && (
          <SettingsView index={index} settings={settings} onSave={saveSettings} onBack={() => setView({ name: "list" })} />
        )}
      </div>
    </div>
  );
}
const wrapStyle = (a) => ({ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontFamily: "'Apple SD Gothic Neo','Pretendard',sans-serif" });

// ─── 목록 ───
function ListView({ index, filters, setFilters, onOpen, onNew, onSettings }) {
  const [showFilter, setShowFilter] = useState(false);

  const counts = useMemo(() => {
    const c = { 전체: index.length, "찜한 도안": 0, 계획: 0, 진행중: 0, 완성: 0 };
    index.forEach((m) => { c[m.status] = (c[m.status] || 0) + 1; });
    return c;
  }, [index]);

  // 실제 입력된 값에서 필터 선택지 생성
  const facetOptions = useMemo(() => {
    const o = {};
    FACETS.forEach(([, key]) => {
      const vals = new Set();
      index.forEach((m) => { const v = (m[key] || "").trim(); if (v) vals.add(v); });
      o[key] = Array.from(vals).sort((a, b) => a.localeCompare(b, "ko"));
    });
    return o;
  }, [index]);

  const activeCount = FACETS.reduce((n, [, key]) => n + (filters[key] !== "전체" ? 1 : 0), 0);

  const list = useMemo(() => index.filter((m) => {
    if (filters.status === "찜한 도안") { if (m.status !== "찜한 도안") return false; }
    else if (filters.status !== "전체" && m.status !== filters.status) return false;
    for (const [, key] of FACETS) {
      if (filters[key] !== "전체" && (m[key] || "").trim() !== filters[key]) return false;
    }
    return true;
  }), [index, filters]);

  const setF = (k, v) => setFilters({ ...filters, [k]: v });
  const clearFacets = () => { const n = { ...filters }; FACETS.forEach(([, k]) => (n[k] = "전체")); setFilters(n); };

  return (
    <>
      <header style={{ padding: "22px 2px 14px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.berry, letterSpacing: ".08em", marginBottom: 3 }}>MY MAKES</div>
          <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.02em" }}>뜨개 프로젝트</div>
        </div>
        <button onClick={onSettings} aria-label="설정" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 700, color: C.sub }}>설정</button>
      </header>

      {/* 상태 필터 — 전체 / 내 작업 / 도안 */}
      <div style={{ display: "flex", gap: 14, justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          {/* 전체 (내 작업 + 도안) */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", marginBottom: 6, visibility: "hidden" }}>전체</div>
            {(() => {
              const on = filters.status === "전체";
              return (
                <button onClick={() => setF("status", "전체")}
                  style={{ padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, border: `1.5px solid ${on ? C.ink : "#D6CCBC"}`, background: on ? C.ink : "#ECE7DD", color: on ? "#fff" : "#6B6258" }}>
                  전체 <span className="mono" style={{ opacity: 0.7 }}>{counts["전체"] || 0}</span>
                </button>
              );
            })()}
          </div>
          {/* 내 작업 */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", color: C.indigo, marginBottom: 6 }}>내 작업</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["계획", "진행중", "완성"].map((s) => {
                const on = filters.status === s;
                return (
                  <button key={s} onClick={() => setF("status", s)}
                    style={{ padding: "7px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, border: `1.5px solid ${on ? C.indigo : "#DCE1EC"}`, background: on ? C.indigo : "#E9ECF4", color: on ? "#fff" : "#4A5168" }}>
                    {s} <span className="mono" style={{ opacity: 0.7 }}>{counts[s] || 0}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {/* 도안 */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", color: "#4F7A4D", marginBottom: 6, textAlign: "right" }}>도안</div>
          {(() => {
            const on = filters.status === "찜한 도안";
            return (
              <button onClick={() => setF("status", "찜한 도안")}
                style={{ padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, border: `1.5px solid ${on ? "#4F7A4D" : "#CADFC8"}`, background: on ? "#4F7A4D" : "#E4EFE2", color: on ? "#fff" : "#436B41" }}>
                찜한 도안 <span className="mono" style={{ opacity: 0.75 }}>{counts["찜한 도안"] || 0}</span>
              </button>
            );
          })()}
        </div>
      </div>

      {/* 상세 필터 토글 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <button onClick={() => setShowFilter((v) => !v)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: activeCount ? C.indigo : C.card, color: activeCount ? "#fff" : C.sub, border: `1px solid ${activeCount ? C.indigo : C.line}`, borderRadius: 10, padding: "7px 13px", fontSize: 12.5, fontWeight: 700 }}>
          필터{activeCount > 0 && <span className="mono" style={{ background: "rgba(255,255,255,.25)", borderRadius: 6, padding: "0 5px" }}>{activeCount}</span>}
          <span style={{ fontSize: 9 }}>{showFilter ? "▲" : "▼"}</span>
        </button>
        {activeCount > 0 && (
          <button onClick={clearFacets} style={{ background: "transparent", border: "none", color: C.berry, fontSize: 12.5, fontWeight: 700, padding: 0 }}>초기화</button>
        )}
      </div>

      {showFilter && (
        <section className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
            {FACETS.map(([label, key]) => {
              const opts = facetOptions[key];
              return (
                <div key={key}>
                  <div className="lbl">{label}</div>
                  <select className="fld" value={filters[key]} onChange={(e) => setF(key, e.target.value)} disabled={!opts.length}
                    style={{ opacity: opts.length ? 1 : 0.5 }}>
                    <option value="전체">전체</option>
                    {opts.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {list.length === 0 ? (
        <section className="card" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{index.length === 0 ? "첫 프로젝트를 기록해 보세요" : "조건에 맞는 프로젝트가 없어요"}</div>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6 }}>{index.length === 0 ? "도안, 바늘, 실, 사진까지 한 곳에 모아둘 수 있어요." : "필터를 바꾸거나 초기화해 보세요."}</div>
        </section>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {list.map((m) => <ProjectCard key={m.id} m={m} onClick={() => onOpen(m.id)} />)}
        </div>
      )}

      {/* 새 프로젝트 */}
      <button onClick={onNew}
        style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 20, background: C.indigo, color: "#fff", border: "none", borderRadius: 999, padding: "14px 26px", fontSize: 15, fontWeight: 700, boxShadow: "0 6px 20px rgba(43,54,80,0.35)" }}>
        + 새 프로젝트
      </button>
    </>
  );
}

function ProjectCard({ m, onClick }) {
  const st = STATUS[m.status] || STATUS["계획"];
  return (
    <button onClick={onClick} className="card" style={{ display: "flex", gap: 13, padding: 11, textAlign: "left", border: `1px solid ${C.line}`, alignItems: "stretch" }}>
      <div style={{ width: 74, height: 74, borderRadius: 10, flexShrink: 0, overflow: "hidden", background: C.cardAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {m.thumb ? <img src={m.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, opacity: 0.4 }}>🧶</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{m.name || "제목 없음"}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: st.c, background: st.bg, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{m.status}</span>
          {m.category && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.sub, background: C.cardAlt, borderRadius: 6, padding: "2px 7px" }}>{m.category}</span>}
        </div>
        {/* 볼밴드풍 스펙 스트립 */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {m.needle && <Spec label="바늘" value={m.needle} />}
          {m.yarn && <Spec label="실" value={m.yarn} />}
          {m.designer && <Spec label="작가" value={m.designer} />}
        </div>
        {m.photoCount > 0 && <span className="mono" style={{ fontSize: 10.5, color: C.sub }}>📷 {m.photoCount}</span>}
      </div>
    </button>
  );
}
function Spec({ label, value }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", maxWidth: 180 }}>
      <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: C.indigo, padding: "2px 5px", letterSpacing: ".03em" }}>{label}</span>
      <span className="mono" style={{ fontSize: 11, color: C.ink, padding: "2px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </span>
  );
}

// ─── 상세/편집 ───
function DetailView({ id, onSave, onDelete, onBack }) {
  const [proj, setProj] = useState(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [pdfState, setPdfState] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const fileRef = useRef(null);
  const printRef = useRef(null);

  useEffect(() => {
    (async () => {
      if (id === "new") setProj(blank());
      else { const p = await getKey(P(id)); setProj(p || blank()); }
    })();
  }, [id]);

  if (!proj) return <div style={{ padding: "60px 0", textAlign: "center", color: C.sub }}>불러오는 중…</div>;

  const set = (patch) => setProj({ ...proj, ...patch });

  const addPhotos = async (files) => {
    if (!files || !files.length) return;
    setBusyPhoto(true);
    const room = MAX_PHOTOS - proj.photos.length;
    const take = Array.from(files).slice(0, Math.max(0, room));
    const added = [];
    for (const f of take) { try { added.push(await fileToDataUrl(f, 1000)); } catch {} }
    setProj({ ...proj, photos: [...proj.photos, ...added] });
    setBusyPhoto(false);
  };
  const removePhoto = (i) => setProj({ ...proj, photos: proj.photos.filter((_, idx) => idx !== i) });

  const handleSave = async () => { await onSave(proj); onBack(); };

  const handlePdf = async () => {
    setPdfState("PDF 만드는 중…");
    try { await exportPdf(printRef.current, (proj.name || "프로젝트").slice(0, 40)); setPdfState(""); }
    catch (e) { setPdfState(e?.message || "PDF 생성에 실패했습니다."); }
  };

  const st = STATUS[proj.status];
  const fields = [
    ["도안", "patternName", "예: 라네토 카디건"],
    ["도안 출처/링크", "patternSource", "예: Ravelry, 책 이름"],
    ["바늘", "needle", "예: 4.0mm 대바늘"],
    ["실", "yarn", "예: 산네스간 선데이 / 그레이"],
    ["실 사용량", "yarnAmount", "예: 4볼 / 200g"],
    ["게이지", "gauge", "예: 22코 30단 / 10cm"],
    ["사이즈", "size", "예: M / 가슴둘레 96cm"],
  ];

  return (
    <>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 2px 12px" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", fontSize: 14, fontWeight: 700, color: C.sub, padding: 0 }}>‹ 목록</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handlePdf} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 13px", fontSize: 13, fontWeight: 700, color: C.indigoDk }}>PDF 저장</button>
          <button onClick={handleSave} style={{ background: C.indigo, border: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, color: "#fff" }}>저장</button>
        </div>
      </header>
      {pdfState && <div style={{ fontSize: 12.5, color: pdfState.includes("실패") ? C.berry : C.sub, padding: "0 2px 10px" }}>{pdfState}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 이름 + 상태 */}
        <section className="card" style={{ padding: 16 }}>
          <div className="lbl">프로젝트명</div>
          <input className="fld" value={proj.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 겨울 라글란 스웨터" style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }} />
          <div className="lbl">상태</div>
          <div style={{ display: "flex", gap: 6 }}>
            {STATUS_ORDER.map((s) => {
              const on = proj.status === s;
              return (
                <button key={s} onClick={() => set({ status: s })}
                  style={{ flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 13, fontWeight: 700, border: `1.5px solid ${on ? STATUS[s].c : C.line}`, background: on ? STATUS[s].c : "#fff", color: on ? "#fff" : C.sub }}>
                  {s}
                </button>
              );
            })}
          </div>
        </section>

        {/* 분류 */}
        <section className="card" style={{ padding: 16 }}>
          <div className="lbl" style={{ marginBottom: 10 }}>분류 (필터 기준)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div className="lbl">유형</div>
              <select className="fld" value={proj.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="">선택 안 함</option>
                {CATEGORIES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <div className="lbl">계절</div>
              <select className="fld" value={proj.season} onChange={(e) => set({ season: e.target.value })}>
                <option value="">선택 안 함</option>
                {SEASONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <div className="lbl">도안 작가</div>
              <input className="fld" value={proj.designer} onChange={(e) => set({ designer: e.target.value })} placeholder="예: PetiteKnit" />
            </div>
          </div>
        </section>

        {/* 사진 */}
        <section className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div className="lbl" style={{ marginBottom: 0 }}>사진</div>
            <span className="mono" style={{ fontSize: 11, color: C.sub }}>{proj.photos.length}/{MAX_PHOTOS}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {proj.photos.map((src, i) => (
              <div key={i} style={{ position: "relative", paddingTop: "100%", borderRadius: 10, overflow: "hidden", background: C.cardAlt }}>
                <img src={src} alt={`사진 ${i + 1}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                <button onClick={() => removePhoto(i)} aria-label="사진 삭제" style={{ position: "absolute", top: 5, right: 5, width: 24, height: 24, borderRadius: 999, border: "none", background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 14 }}>×</button>
              </div>
            ))}
            {proj.photos.length < MAX_PHOTOS && (
              <button onClick={() => fileRef.current?.click()} disabled={busyPhoto}
                style={{ paddingTop: "100%", position: "relative", borderRadius: 10, border: `1.5px dashed ${C.line}`, background: C.cardAlt }}>
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: C.sub }}>
                  {busyPhoto ? "추가 중…" : "+ 사진"}
                </span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
        </section>

        {/* 도안/바늘/실 등 */}
        <section className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 13 }}>
          {fields.map(([label, key, ph]) => (
            <div key={key}>
              <div className="lbl">{label}</div>
              <input className="fld" value={proj[key]} onChange={(e) => set({ [key]: e.target.value })} placeholder={ph} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="lbl">시작일</div>
              <input className="fld" type="date" value={proj.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="lbl">완성일</div>
              <input className="fld" type="date" value={proj.doneDate} onChange={(e) => set({ doneDate: e.target.value })} />
            </div>
          </div>
          <div>
            <div className="lbl">메모</div>
            <textarea className="fld" rows={4} value={proj.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="진행 노트, 코 수 변경, 다음에 고칠 점 등" style={{ resize: "vertical", lineHeight: 1.5 }} />
          </div>
        </section>

        {/* 삭제 */}
        {id !== "new" && (
          <div style={{ textAlign: "center", paddingTop: 4 }}>
            {confirmDel ? (
              <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: C.sub }}>정말 삭제할까요?</span>
                <button onClick={() => onDelete(proj.id).then(onBack)} style={{ border: "none", background: C.berry, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700 }}>삭제</button>
                <button onClick={() => setConfirmDel(false)} style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700 }}>취소</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)} style={{ border: "none", background: "transparent", color: C.berry, fontSize: 13, fontWeight: 700 }}>프로젝트 삭제</button>
            )}
          </div>
        )}
      </div>

      {/* PDF용 인쇄 레이아웃 (화면 밖) */}
      <div style={{ position: "absolute", left: -99999, top: 0 }} aria-hidden="true">
        <PrintSheet ref={printRef} proj={proj} />
      </div>
    </>
  );
}

// ─── PDF 인쇄 시트 ───
const PrintSheet = React.forwardRef(function PrintSheet({ proj }, ref) {
  const rows = [
    ["상태", proj.status], ["유형", proj.category], ["계절", proj.season],
    ["도안", proj.patternName], ["도안 작가", proj.designer], ["도안 출처", proj.patternSource],
    ["바늘", proj.needle], ["실", proj.yarn], ["실 사용량", proj.yarnAmount],
    ["게이지", proj.gauge], ["사이즈", proj.size],
    ["시작일", fmtDate(proj.startDate)], ["완성일", fmtDate(proj.doneDate)],
  ];
  return (
    <div ref={ref} style={{ width: 760, background: "#fff", padding: 48, fontFamily: "'Apple SD Gothic Neo','Malgun Gothic',sans-serif", color: "#2C2724" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#A23B52", letterSpacing: "0.1em", marginBottom: 6 }}>KNITTING PROJECT</div>
      <div style={{ fontSize: 30, fontWeight: 800, marginBottom: 22, borderBottom: "3px solid #2C2724", paddingBottom: 14 }}>{proj.name || "제목 없음"}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: "1px solid #E3DACA" }}>
              <td style={{ width: 120, padding: "9px 0", fontSize: 13, fontWeight: 700, color: "#8A8076", verticalAlign: "top" }}>{k}</td>
              <td style={{ padding: "9px 0", fontSize: 14.5, verticalAlign: "top" }}>{v || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {proj.notes && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8A8076", marginBottom: 6 }}>메모</div>
          <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{proj.notes}</div>
        </div>
      )}
      {proj.photos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {proj.photos.map((src, i) => (
            <img key={i} src={src} alt="" style={{ width: "calc(50% - 5px)", borderRadius: 8, display: "block" }} />
          ))}
        </div>
      )}
    </div>
  );
});

// ─── 설정 (동기화/내보내기) ───
function SettingsView({ index, settings, onSave, onBack }) {
  const [sheet, setSheet] = useState(settings.sheetName);
  const [sync, setSync] = useState({ busy: false, msg: "" });

  const collectAll = async () => {
    const out = [];
    for (const m of index) { const p = await getKey(P(m.id)); if (p) out.push(p); }
    return out;
  };

  const doCsv = async () => {
    const projects = await collectAll();
    if (!projects.length) { setSync({ busy: false, msg: "내보낼 프로젝트가 없습니다." }); return; }
    downloadCsv(projects, sheet.trim() || "뜨개프로젝트");
    setSync({ busy: false, msg: "CSV 파일을 내려받았습니다. Google Sheets에서 '파일 → 가져오기'로 열 수 있어요." });
  };

  return (
    <>
      <header style={{ display: "flex", alignItems: "center", padding: "18px 2px 14px" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", fontSize: 14, fontWeight: 700, color: C.sub, padding: 0 }}>‹ 목록</button>
        <div style={{ fontSize: 17, fontWeight: 800, marginLeft: 12 }}>설정</div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <section className="card" style={{ padding: 16 }}>
          <div className="lbl">내보내기 파일 이름</div>
          <input className="fld" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="뜨개프로젝트" style={{ marginBottom: 8 }} />
          <button onClick={() => onSave({ ...settings, sheetName: sheet.trim() || "뜨개프로젝트" })}
            style={{ fontSize: 12.5, fontWeight: 700, color: C.indigoDk, background: "transparent", border: "none", padding: 0 }}>이름 저장</button>

          <div style={{ borderTop: `1px solid ${C.line}`, margin: "14px 0 0", paddingTop: 14 }}>
            <button onClick={doCsv}
              style={{ width: "100%", padding: "12px 0", borderRadius: 11, border: "none", background: C.indigo, color: "#fff", fontSize: 14, fontWeight: 700 }}>
              CSV 파일로 내보내기
            </button>
            {sync.msg && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 10, lineHeight: 1.5 }}>{sync.msg}</div>}
          </div>
        </section>

        <div style={{ fontSize: 11.5, color: C.sub, padding: "0 4px", lineHeight: 1.65 }}>
          모든 데이터는 이 브라우저 안에만 저장됩니다(서버 전송 없음). CSV에는 텍스트 정보(도안·바늘·실·메모 등)만 담기고, 사진은 앱 안과 PDF에만 담겨요. CSV는 Google Sheets·Excel에서 바로 열 수 있습니다.
        </div>
      </div>
    </>
  );
}
