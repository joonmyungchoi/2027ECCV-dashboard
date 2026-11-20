// 실험 대시보드 제너릭 부트 — data/dashboard.json(구성)을 읽어 nav·패널 생성, 실험별 차트는 experiments/<id>.js 의 window.render_<id>().
// 내장 기능: ① 인사이트 드로어(생성·수정·삭제·그룹·휴지통·상태캡처·강조박스·이동) ② 편집 모드(텍스트 수정·숨김·이동·추가,
// 카드 드래그 정렬·격자 리사이즈·숨김+관리 드로어). 모든 편집 상태는 data/*.json 으로 POST 저장되어 새로고침에도 유지.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
let CFG = {}, EXP_TO_TAB = {};

const FAILED_MODULES = new Set();   // 로드 실패한 experiments/<id>.js — 패널에 원인을 표시하기 위해 기록
function loadScript(src) {
  return new Promise((res) => {
    const s = document.createElement("script"); s.src = src;
    s.onload = res;
    s.onerror = () => { FAILED_MODULES.add(src.split("?")[0]); console.error("모듈 로드 실패:", src); res(); };   // 실패해도 부팅은 계속하되 조용히 넘기지 않음
    document.head.appendChild(s);
  });
}

async function boot() {
  const t = Date.now();
  const get = (f, fb) => fetch(`data/${f}?t=${t}`, { cache: "no-store" }).then((r) => r.json()).catch(() => fb);
  // 전부 병렬 한 방 — 순차 await는 왕복 지연이 파일 수만큼 누적돼 로드가 느려짐(특히 터널 경유).
  const [cfg, insights, tOv, tl, pOrd, pSz, pHid, tabOrd, navHid, tabHid] = await Promise.all([
    get("dashboard.json", { title: "실험 대시보드", groups: [], experiments: {} }),
    get("insights.json", { exp: {} }),
    get("text-overrides.json", {}),
    get("text-layout.json", { hidden: {}, moves: [], added: {} }),
    get("panel-order.json", {}),
    get("panel-size.json", {}),
    get("panel-hidden.json", {}),
    get("tab-order.json", []),
    get("nav-hidden.json", {}),   // 드래그로 지운 상위 섹션
    get("tab-hidden.json", {}),   // 드래그로 지운 하위 그룹
  ]);
  CFG = cfg;
  applyTabOrder(tabOrd);   // 저장된 상단 탭 순서 반영(드래그 재정렬)
  CFG.groups.forEach((g) => g.experiments.forEach((eid) => (EXP_TO_TAB[eid] = g.id)));
  migrateInsights(insights);
  textOverrides = tOv;
  hiddenText = tl.hidden || {}; textMoves = tl.moves || []; userText = tl.added || {}; textStyles = tl.styles || {};
  panelOrder = pOrd; panelSize = pSz; panelHidden = pHid;
  navHidden = navHid || {}; groupHidden = tabHid || {};
  DATA = { cfg: CFG, insights };
  await Promise.all(Object.keys(CFG.experiments || {}).map((id) => loadScript(`experiments/${id}.js?t=${t}`)));
  renderMast(); buildLayout();
  initInsightsDrawer(); initTextEditor(); initPanelManager();   // buildLayout 뒤 — tab-actions가 #tabs에 붙음
  if (purgeOldTrash(insights)) saveInsights();   // 24시간 지난 휴지통 항목은 이 로드 시점에 영구삭제
  if (normHidden(navHidden)) saveNavHidden();       // legacy(true) 이관 + 24h 경과분 완전삭제
  if (normHidden(groupHidden)) saveGroupHidden();
  setupNav(); setupExtras(); activateInitialTab();
  applyTabHidden();   // activateInitialTab 뒤 — 첫 진입 탭이 지워진 탭이면 살아있는 탭으로 넘긴다
  applyTextEditing(document.getElementById("masthead"));
  syncTabTitle();
  document.getElementById("footLeft").textContent = CFG.footLeft || "";
  document.getElementById("footMeta").textContent = CFG.footMeta || "";
}


// 공유 링크 복사 · 맨 위로. 복사되는 URL 은 현재 하위 탭의 해시라 그 탭이 바로 열린다(복원은 activateInitialTab).
function setupExtras() {
  const sb = document.getElementById("btnShare");
  if (sb) sb.onclick = () => navigator.clipboard.writeText(location.href)
    .then(() => { sb.textContent = "✓ 복사됨"; setTimeout(() => (sb.textContent = "⧉ 링크 복사"), 1600); })
    .catch(() => { sb.textContent = location.href; });
  const tt = document.getElementById("toTop");
  if (tt) {
    addEventListener("scroll", () => tt.classList.toggle("show", scrollY > 480), { passive: true });
    tt.onclick = () => scrollTo({ top: 0, behavior: "smooth" });
  }
}


// 브라우저 탭 제목 = 헤더 제목(h1) — 페이지에서 더블클릭으로 제목을 고치면 탭 이름도 따라감.
function syncTabTitle() {
  const h = document.querySelector(".mast-title h1");
  if (h && h.textContent.trim()) document.title = h.textContent.trim();
}

function renderMast() {
  // 브라우저 탭 제목 = dashboard.json title(HTML 태그 제거)
  document.title = (CFG.title || "실험 대시보드").replace(/<[^>]*>/g, "");
  document.getElementById("mastKicker").textContent = CFG.kicker || "";
  document.getElementById("mastTitle").innerHTML = CFG.title || "실험 대시보드";
  document.getElementById("mastLede").innerHTML = CFG.lede || "";
  document.getElementById("mastStat").innerHTML = (CFG.kpis || []).map((k) =>
    `<div class="kpi ${k.tone || ""}"><b>${esc(k.value)}</b><span>${esc(k.label)}</span></div>`).join("");
}

// ── 하위 탭(그룹) 드래그 재정렬 — 같은 상위 섹션 안에서만 이동. tab-order.json에 저장 ──
// 상위 섹션의 구성·순서는 dashboard.json navGroups가 정본이라 드래그 대상이 아니다.
function applyTabOrder(order) {
  if (!Array.isArray(order) || !order.length || !CFG.groups) return;
  const byId = {}; CFG.groups.forEach((g) => (byId[g.id] = g));
  const seen = new Set(), ordered = [];
  order.forEach((id) => { if (byId[id]) { ordered.push(byId[id]); seen.add(id); } });
  CFG.groups.forEach((g) => { if (!seen.has(g.id)) ordered.push(g); });   // 저장 안 된 새 그룹은 뒤에
  CFG.groups = ordered;
}
function saveTabOrder() {
  // 모든 하위 행을 DOM 순서대로 이어붙인 평면 목록 — applyTabOrder가 CFG.groups 순서로 되돌리고,
  // buildNav가 그 순서로 각 행을 정렬하므로 행 안의 순서가 그대로 복원된다.
  const order = [...document.querySelectorAll("#subtabs button[data-tab]")].map((b) => b.dataset.tab);
  const byId = {}; CFG.groups.forEach((g) => (byId[g.id] = g));
  CFG.groups = order.map((id) => byId[id]).filter(Boolean).concat(CFG.groups.filter((g) => !order.includes(g.id)));
  fetch("api/tab-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) }).catch((e) => console.error("tab-order 저장 실패", e));
}

// ── 탭 숨김(=드래그 삭제) ────────────────────────────────────────────────────
// 상위 섹션 → nav-hidden.json · 하위 그룹 → tab-hidden.json. **서버에 저장하는 게 핵심**이다 —
// 예전엔 탭을 휴지통에 떨궈도 저장 경로가 없어(그리고 숨김 적용도 막혀 있어) 새로고침하면 그대로 돌아왔다.
// 삭제는 파괴가 아니라 숨김이다: 24h 안에는 편집 드로어에서 복원할 수 있고, 지나면 purged로 굳는다.
const HIDE_TTL = 24 * 3600 * 1000;
let navHidden = {};     // { navId: {t, purged?} }
let groupHidden = {};   // { groupId: {t, purged?} }
function normHidden(map) {   // legacy true → {t:now} 이관 + TTL 경과분 purged. 반환 = 변경 여부
  let ch = false; const now = Date.now();
  Object.keys(map || {}).forEach((k) => {
    if (map[k] === true) { map[k] = { t: now }; ch = true; }
    if (map[k] && !map[k].purged && now - (map[k].t || 0) > HIDE_TTL) { map[k].purged = true; ch = true; }
  });
  return ch;
}
const _post = (path, body, what) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .catch((e) => console.error(`${what} 저장 실패`, e));
function saveNavHidden() { _post("api/nav-hidden", navHidden, "nav-hidden"); }
function saveGroupHidden() { _post("api/tab-hidden", groupHidden, "tab-hidden"); }
// 살아있는 첫 하위 탭 — 보고 있던 탭이 지워졌을 때 갈 곳.
const tabAlive = (id) => !groupHidden[id] && !navHidden[NAV_OF[id]];
const firstAliveTab = () => (CFG.groups || []).map((g) => g.id).find(tabAlive);
function applyTabHidden() {
  document.querySelectorAll("#subtabs button[data-tab]").forEach((b) => {
    b.style.display = groupHidden[b.dataset.tab] ? "none" : "";
  });
  NAV.forEach((n) => {
    // 하위가 전부 지워진 섹션도 감춘다 — 눌러 봐야 빈 행이라 남겨 두면 고장난 것처럼 보인다.
    const off = !!navHidden[n.id] || !n.groups.some((g) => !groupHidden[g]);
    const b = document.querySelector(`#tabs button[data-nav="${CSS.escape(n.id)}"]`);
    if (b) b.style.display = off ? "none" : "";
  });
  const cur = document.querySelector(".tab-panel.active");
  if (cur && !tabAlive(cur.id)) { const t = firstAliveTab(); if (t) selectTab(t); }
  updateTabHiddenCount();
}
function updateTabHiddenCount() {
  const n = Object.values(navHidden).filter((v) => v && !v.purged).length
          + Object.values(groupHidden).filter((v) => v && !v.purged).length;
  const b = document.getElementById("tabHiddenCount"); if (b) b.textContent = n;
}
function hideNav(id) { navHidden[id] = { t: Date.now() }; saveNavHidden(); applyTabHidden(); renderPanelManager(); }
function showNav(id) { delete navHidden[id]; saveNavHidden(); applyTabHidden(); renderPanelManager(); }
function purgeNav(id) { if (navHidden[id]) { navHidden[id].purged = true; saveNavHidden(); applyTabHidden(); renderPanelManager(); } }
function hideGroup(id) { groupHidden[id] = { t: Date.now() }; saveGroupHidden(); applyTabHidden(); renderPanelManager(); }
function showGroup(id) { delete groupHidden[id]; saveGroupHidden(); applyTabHidden(); renderPanelManager(); }
function purgeGroup(id) { if (groupHidden[id]) { groupHidden[id].purged = true; saveGroupHidden(); applyTabHidden(); renderPanelManager(); } }

// ── 탭 드래그 — pointer 기반 ────────────────────────────────────────────────
// native HTML5 draggable을 버튼에 걸면 클릭과 충돌해 드래그 시작 자체가 브라우저마다 다르게 실패한다.
// (그게 "삭제가 될 때도 있고 안 될 때도 있던" 원인이다.) pointer 이벤트는 그 불확실성이 없다.
// 재정렬은 상시, 삭제는 휴지통 드롭 또는 탭바 밖(여유 M px) 릴리스 — 편집모드 여부와 무관하다.
function wireTabDrag(container, sel, opt) {
  container.querySelectorAll(sel).forEach((b) => { b.draggable = false; });   // native drag 끔(고스트 중복 방지)
  if (container.dataset.ptrWired) return;   // 컨테이너 리스너는 한 번만
  container.dataset.ptrWired = "1";
  let suppressClick = false, lastDrag = null;
  container.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const b = e.target.closest(sel); if (!b || b.isContentEditable) return;
    const drag = b, startX = e.clientX, startY = e.clientY;
    let moved = false, ghost = null, lastX = startX, lastY = startY;
    const onMove = (ev) => {
      lastX = ev.clientX; lastY = ev.clientY;
      if (!moved) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;   // 총 이동거리 기준 — 세로(삭제 방향) 드래그도 시작되게
        moved = true; drag.classList.add("tab-dragging");
        const tz0 = document.getElementById("textTrash"); if (tz0) tz0.classList.add("show");   // 드래그 중엔 모드와 무관하게 휴지통을 띄운다
        ghost = document.createElement("div"); ghost.className = "tab-ghost"; ghost.textContent = drag.textContent;
        document.body.appendChild(ghost);
      }
      if (ghost) { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; }
      const tzm = document.getElementById("textTrash");
      if (tzm) { const r = tzm.getBoundingClientRect(); tzm.classList.toggle("hot", ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom); }
      if (!opt.reorder) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const over = el && el.closest && el.closest(sel);
      // 행을 넘는 이동은 막는다 — 섹션 소속은 navGroups가 정해야 하는데 평면 order로는 표현할 수 없다.
      if (over && over !== drag && over.parentElement === drag.parentElement) {
        const box = over.getBoundingClientRect();
        over.parentElement.insertBefore(drag, ev.clientX > box.left + box.width / 2 ? over.nextSibling : over);
      }
    };
    const onUp = (ev) => {
      document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("pointercancel", onUp);
      // pointercancel(터치를 스크롤로 가로챈 경우)엔 좌표가 신뢰할 수 없어 마지막 pointermove 지점으로 판정
      const x = ev.type === "pointercancel" ? lastX : ev.clientX, y = ev.type === "pointercancel" ? lastY : ev.clientY;
      const tz = document.getElementById("textTrash");
      const tr = tz && tz.classList.contains("show") ? tz.getBoundingClientRect() : null;   // ★숨기기 전에 rect 확보(숨긴 뒤엔 0×0)
      if (tz) tz.classList.remove("show", "hot");
      if (ghost) { ghost.remove(); ghost = null; }
      drag.classList.remove("tab-dragging");
      if (!moved) return;                     // 안 움직였으면 그냥 클릭 = 탭 전환
      suppressClick = true; lastDrag = drag;   // 드래그 끝에 따라오는 유령 클릭 억제
      const onTrash = !!tr && x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom;
      const bar = (opt.bar || container).getBoundingClientRect(), M = opt.margin || 60;
      const offBar = y > bar.bottom + M || y < bar.top - M || x > bar.right + M || x < bar.left - M;
      if (onTrash || offBar) { opt.onDelete(drag); return; }
      if (opt.reorder) opt.onReorder();
    };
    document.addEventListener("pointermove", onMove); document.addEventListener("pointerup", onUp); document.addEventListener("pointercancel", onUp);
  });
  // 드래그한 그 버튼의 유령 클릭만 막는다(편집·인사이트 버튼 등 다른 클릭은 통과)
  container.addEventListener("click", (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    if (e.target.closest(sel) === lastDrag) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
function wireTabReorder() {
  // 상위 섹션 — 순서는 navGroups가 정본이라 재정렬은 없고, 삭제만 받는다.
  wireTabDrag(document.getElementById("tabs"), "button[data-nav]", {
    reorder: false, margin: 60, onDelete: (b) => hideNav(b.dataset.nav),
  });
  // 하위 그룹 — 같은 행 안에서 재정렬 + 삭제.
  wireTabDrag(document.getElementById("subtabs"), "button[data-tab]", {
    reorder: true, margin: 50, onDelete: (b) => hideGroup(b.dataset.tab), onReorder: saveTabOrder,
  });
}

// ── 2단 네비 — 상위(navGroups) / 하위(그룹). 하위 버튼의 data-tab은 그대로 그룹 id라
//    해시 딥링크·인사이트 이동·카드 관리 등 기존 그룹 id 계약이 전부 유지된다. ──
let NAV = [];              // [{ id, name, groups:[groupId] }]
const NAV_OF = {};         // groupId → navId
const groupById = (id) => (CFG.groups || []).find((g) => g.id === id);
function buildNav() {
  const claimed = new Set();
  NAV = (CFG.navGroups || []).map((n) => {
    const ids = (n.groups || []).filter(groupById);
    ids.forEach((id) => claimed.add(id));
    // sections = 하위 행 안의 라벨 구분(선택). 없으면 종전과 동일한 평면 행.
    const secs = (n.sections || []).map((x) => ({ label: x.label, groups: (x.groups || []).filter(groupById) }))
      .filter((x) => x.groups.length);
    return { id: n.id, name: n.name, groups: ids, sections: secs };
  }).filter((n) => n.groups.length);
  // navGroups에 없는 그룹은 자기 자신만 담은 상위 항목으로 승격 — dashboard.json에 그룹만 추가돼도 사라지지 않게.
  CFG.groups.forEach((g) => { if (!claimed.has(g.id)) NAV.push({ id: "nav_" + g.id, name: g.name, groups: [g.id] }); });
  // 하위 순서는 CFG.groups(=tab-order.json 반영) 기준 — 드래그 재정렬이 그대로 반영된다.
  const rank = {}; CFG.groups.forEach((g, i) => (rank[g.id] = i));
  NAV.forEach((n) => {
    n.groups.sort((a, b) => rank[a] - rank[b]); n.groups.forEach((id) => (NAV_OF[id] = n.id));
    (n.sections || []).forEach((sc) => sc.groups.sort((a, b) => rank[a] - rank[b]));
  });
}

// ── 합친 탭의 내부 갈래 — experiments 2개 이상이면 세그먼트로 가른다(쌓으면 스크롤이 길어진다) ──
// 이름은 group.expNames[eid] · 없으면 experiments[eid].title 앞머리. 갈래 전환은 표시/숨김이라 렌더는 1회뿐이다.
function expSeg(g) {
  if (!g.experiments || g.experiments.length < 2) return "";
  const nm = (eid) => (g.expNames || {})[eid] || ((CFG.experiments || {})[eid] || {}).title || eid;
  return `<div class="exp-seg" data-group="${g.id}">${g.experiments.map((eid, i) =>
    `<button type="button" data-exp="${eid}" class="${i ? "" : "on"}">${esc(nm(eid))}</button>`).join("")}</div>`;
}
// 갈래 전환은 이 함수 하나로 — 클릭 핸들러와 딥링크 복원이 같은 경로를 쓴다(핸들러 배선 전에도 동작).
function showExp(gid, eid) {
  const seg = document.querySelector(`.exp-seg[data-group="${gid}"]`); if (!seg) return;
  seg.querySelectorAll("button[data-exp]").forEach((x) => {
    const on = x.dataset.exp === eid;
    x.classList.toggle("on", on);
    const host = document.getElementById(x.dataset.exp);
    if (host) host.hidden = !on;
  });
  const act = document.getElementById(eid);
  if (act) deferResize(act);   // 숨은 동안 크기 0이던 차트를 다시 맞춘다
}
function wireExpSeg(root) {
  (root || document).querySelectorAll(".exp-seg:not([data-wired])").forEach((seg) => {
    seg.dataset.wired = "1";
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-exp]");
      if (b) showExp(seg.dataset.group, b.dataset.exp);
    });
  });
}

// nav + 그룹 페이지 컨테이너 생성
// 탭 머리에 오는 것은 제목 · 목적 · 세팅 셋뿐이다(PRODUCT.md 원칙).
// goal 은 dashboard.json 스키마에 원래 있었지만 어디서도 그려지지 않던 필드다 — 이제 여기서 쓴다.
// desc 는 goal 이 없는 기존 프로젝트를 위한 하위호환 자리다.
function groupBrief(g) {
  const E = g.experiments.length === 1 ? (CFG.experiments || {})[g.experiments[0]] || {} : {};
  const goal = g.goal || E.goal || g.desc || "";
  const setup = g.setup || E.setup || "";
  return (goal || setup) ? expBrief({ goal: esc(goal), setup: esc(setup) }) : "";
}

function buildLayout() {
  buildNav();
  // group id 와 experiment id 가 같으면 DOM id 가 겹쳐 getElementById 가 <section> 을 집는다
  // → 렌더러의 innerHTML 이 group-head(제목·목적·세팅)를 통째로 덮어버린다. 에러 없이 조용히 비므로 여기서 잡는다.
  CFG.groups.forEach((g) => g.experiments.forEach((eid) => { if (eid === g.id)
    console.error(`dashboard.json: group id 와 experiment id 가 같다("${g.id}") — 탭 머리가 사라진다. 한쪽 이름을 바꿔라.`); }));
  document.getElementById("tabs").innerHTML =
    NAV.map((n) => `<button data-nav="${n.id}" type="button">${esc(n.name)}</button>`).join("");
  document.getElementById("subtabs").innerHTML =
    NAV.map((n) => {
      const btn = (id) => `<button data-tab="${id}" type="button">${esc(groupById(id).name)}</button>`;
      const secs = n.sections || [];
      // 섹션이 선언돼 있으면 라벨 구분으로, 아니면 평면으로. 선언 밖 그룹은 뒤에 붙여 사라지지 않게 한다.
      const inSec = new Set(secs.flatMap((x) => x.groups));
      const rest = n.groups.filter((id) => !inSec.has(id));
      const body = secs.length
        ? secs.map((x) => `<span class="subsec">${esc(x.label)}</span>${x.groups.map(btn).join("")}`).join("")
          + rest.map(btn).join("")
        : n.groups.map(btn).join("");
      return `<div class="subrow" data-nav="${n.id}">${body}</div>`;
    }).join("");
  document.getElementById("main").innerHTML =
    CFG.groups.map((g) => `<section id="${g.id}" class="tab-panel"${g.mdl ? ` data-mdl="${esc(g.mdl)}"` : ""}>
      <div class="group-head"><h2>${esc(g.name)}</h2>${groupBrief(g)}</div>
      ${expSeg(g)}${g.experiments.map((eid, i) => {
        const em = ((CFG.experiments || {})[eid] || {}).mdl;   // 한 탭에 출처가 다른 실험이 섞이면 패널 기본값을 실험 단위로 덮는다
        return `<div id="${eid}" class="exp-block"${em ? ` data-mdl="${esc(em)}"` : ""}${g.experiments.length > 1 && i ? ' hidden' : ""}>
        <div class="loading">불러오는 중…</div></div>`;
      }).join("")}
    </section>`).join("");
  wireTabReorder();
}

// ── Plotly 리사이즈 — 컨테이너 실제 픽셀 크기로 명시 relayout(autosize가 컨테이너 변화를 못 따라가는 경우 방지) ──
function resizePlot(p) {
  try {
    const w = Math.round(p.clientWidth), h = Math.round(p.clientHeight);
    if (w > 0 && h > 0 && window.Plotly && Plotly.relayout) Plotly.relayout(p, { width: w, height: h });
    else if (window.Plotly && Plotly.Resize) Plotly.Resize(p);
  } catch (e) {}
}
function resizePanel(panel) { panel.querySelectorAll(".js-plotly-plot").forEach(resizePlot); }
// 레이아웃(flex 폭)이 확정된 뒤 한 번 더 — 첫 렌더 시 카드보다 좁게 그려지고 안 커지는 문제 방지.
function deferResize(container) {
  if (!container) return;
  requestAnimationFrame(() => requestAnimationFrame(() => resizePanel(container)));
}

// 탭별 렌더(async fetch+Plotly)를 프로미스로 메모이즈 — 인사이트 "이동"이 렌더 완료를 await해 빈 컨테이너에 상태·스크롤·박스가 적용되던 race를 없앰.
const _renderPromise = new Map();
function ensureTab(tab) {
  if (_renderPromise.has(tab)) return _renderPromise.get(tab);   // 진행 중이거나 완료된 렌더는 같은 프로미스 반환(이중 렌더 방지 + await 가능)
  const g = CFG.groups.find((x) => x.id === tab); if (!g) return Promise.resolve();
  // render_<id>가 async(fetch 후 innerHTML)면 완료를 기다려야 후처리(드래그·리사이즈·텍스트편집)와 인사이트 이동이 패널을 찾음.
  const p = (async () => {
    await Promise.all(g.experiments.map(async (eid) => {
      const host = document.getElementById(eid);   // 없을 수 있음 — catch 안에서 재차 throw 되지 않게 먼저 잡아둔다
      const fn = window["render_" + eid];
      if (!fn) {   // 모듈 로드 실패·렌더러 미정의 → 빈 패널로 두지 않고 원인을 표시(패널마다 동작이 달라 보이던 원인)
        const why = FAILED_MODULES.has(`experiments/${eid}.js`) ? "스크립트 로드 실패" : "렌더러 미정의";
        console.error(`render_${eid} 없음 — ${why}`);
        if (host) host.innerHTML = `<div class="loading">render_${eid} 없음 — experiments/${eid}.js ${why}</div>`;
        return;
      }
      try { await fn(); } catch (e) {
        console.error(`render_${eid} 오류`, e);
        if (host) host.innerHTML = `<div class="loading">render_${eid} 오류: ${e.message}</div>`;
      }
    }));
    const el = document.getElementById(tab);
    applyTextEditing(el); enablePanelReorder(el); deferResize(el); collapseProse(el); proseWatch(); wireExpSeg(el); applyTableMdl(el);
  })();
  _renderPromise.set(tab, p);
  return p;
}

// 상위 탭 전환 — 활성 표시 + 해당 하위 행만 노출. 하위 탭 선택은 selectTab이 맡는다.
const _lastSub = {};   // navId → 그 섹션에서 마지막으로 본 하위 탭(되돌아왔을 때 복원)
function setNav(navId) {
  document.querySelectorAll("#tabs button[data-nav]").forEach((b) =>
    b.classList.toggle("active", b.dataset.nav === navId));
  document.querySelectorAll("#subtabs .subrow").forEach((r) =>
    r.classList.toggle("active", r.dataset.nav === navId));
}
function selectTab(tab) {
  const btn = document.querySelector(`#subtabs button[data-tab="${tab}"]`); if (!btn) return;
  const nav = NAV_OF[tab]; if (nav) { setNav(nav); _lastSub[nav] = tab; }
  document.querySelectorAll("#subtabs button[data-tab]").forEach((x) => x.classList.toggle("active", x === btn));
  let active;
  document.querySelectorAll(".tab-panel").forEach((p) => { const on = p.id === tab; p.classList.toggle("active", on); if (on) active = p; });
  // suppressOutsideClose 중(=인사이트 이동이 프로그램적으로 탭 전환)엔 scrollTo(0) 생략 — 저장된 scrollY 복원과 경쟁 방지.
  if (active) {
    history.replaceState(null, "", "#" + tab);   // 해시 딥링크(로컬 기능)
    ensureTab(tab); resizePanel(active); deferResize(active);
    applyTextEditing(active);   // 탭 이동 시 항상 재적용 — 수정·이동·숨김이 동적 렌더 뒤에도 유지되게
    if (!suppressOutsideClose) window.scrollTo({ top: 0, behavior: "smooth" });
  }
}
// 첫 진입 탭 — 해시(#그룹id)가 유효하면 그쪽, 아니면 첫 그룹.
// 목적 기반 병합(§1-4)으로 그룹 id 가 바뀐 옛 링크(#dacontext 처럼 이제는 experiment id)도 살린다 —
// 그 experiment 를 품은 그룹을 열고 세그먼트를 그 갈래로 맞춘다.
function activateInitialTab() {
  const h = location.hash.slice(1);
  if (groupById(h)) return selectTab(h);
  const owner = (CFG.groups || []).find((g) => (g.experiments || []).includes(h));
  if (owner) {
    selectTab(owner.id);
    showExp(owner.id, h);
    return;
  }
  selectTab((CFG.groups[0] || {}).id);
}
function setupNav() {
  document.getElementById("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-nav]"); if (!b || b.isContentEditable) return;   // 상위 탭만(편집·인사이트 버튼 제외)
    const nav = NAV.find((n) => n.id === b.dataset.nav); if (!nav) return;
    setNav(nav.id);
    selectTab(nav.groups.includes(_lastSub[nav.id]) ? _lastSub[nav.id] : nav.groups[0]);
  });
  document.getElementById("subtabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b || b.isContentEditable) return;
    selectTab(b.dataset.tab);
  });
  // 명시적 크기로 relayout하면 Plotly 자체 responsive가 꺼지므로, 창 크기 변경 시 활성 탭 차트를 직접 다시 맞춤.
  let _winRz = null;
  window.addEventListener("resize", () => {
    clearTimeout(_winRz);
    _winRz = setTimeout(() => { const active = document.querySelector(".tab-panel.active"); if (active) resizePanel(active); }, 150);
  });
}
function gotoTab(tab) { selectTab(tab); }   // 다른 상위 섹션의 탭이어도 selectTab이 상위까지 함께 전환

// ── 드래그 중 가장자리 자동 스크롤 — HTML5 DnD는 창을 스크롤해주지 않아 화면 밖 목적지로 못 옮기는 문제 해결 ──
// 포인터가 위/아래 가장자리 90px 안에 들어오면 근접도에 비례한 속도로 스크롤(카드·인사이트·텍스트 드래그 공통).
const AS_EDGE = 90, AS_MAX = 26;
let _asY = null, _asEl = null, _asT = 0, _asRaf = null;
function _autoScrollStep() {
  if (_asY == null || performance.now() - _asT > 300) { _asRaf = null; _asY = null; _asEl = null; return; }
  let top = 0, bottom = innerHeight;
  if (_asEl) { const r = _asEl.getBoundingClientRect(); top = r.top; bottom = r.bottom; }
  let v = 0;
  if (_asY < top + AS_EDGE) v = -AS_MAX * (1 - (_asY - top) / AS_EDGE);
  else if (_asY > bottom - AS_EDGE) v = AS_MAX * (1 - (bottom - _asY) / AS_EDGE);
  if (v) { if (_asEl) _asEl.scrollTop += v; else window.scrollBy(0, v); }
  _asRaf = requestAnimationFrame(_autoScrollStep);
}
document.addEventListener("dragover", (e) => {
  _asY = e.clientY; _asT = performance.now();
  const pop = e.target.closest ? e.target.closest("#insightsPop") : null;   // 드로어 안에선 드로어 목록을 스크롤
  _asEl = pop ? document.getElementById("insightsList") : null;
  if (!_asRaf) _asRaf = requestAnimationFrame(_autoScrollStep);
});
const _asStop = () => { _asY = null; _asEl = null; };
document.addEventListener("drop", _asStop);
document.addEventListener("dragend", _asStop);

// 탭 바 오른쪽 끝의 액션 버튼 컨테이너 — 편집·인사이트 버튼 고정 위치.
function tabActions() {
  let el = document.querySelector(".tab-actions");
  if (!el) { el = document.createElement("div"); el.className = "tab-actions"; document.getElementById("tabs").appendChild(el); }
  return el;
}

// ═══════════════ 카드(패널) 편집 — 드래그 정렬 · 격자 리사이즈 · 숨김 + 관리 드로어 ═══════════════
let panelOrder = {};
function panelKey(panel) {
  const idEl = panel.querySelector("[id]");
  if (idEl) return idEl.id;
  const h3 = panel.querySelector("h3");
  return h3 ? h3.textContent.trim() : null;
}
function savePanelOrder() {
  fetch("api/panel-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(panelOrder) })
    .catch((e) => console.error("panel-order 저장 실패", e));
}
function applySavedPanelOrder(parent, scopeKey) {
  const saved = panelOrder[scopeKey]; if (!saved || !saved.length) return;
  const byKey = {};
  [...parent.children].forEach((c) => { if (c.classList.contains("panel")) byKey[c.dataset.pkey] = c; });
  saved.forEach((k) => { const el = byKey[k]; if (el) parent.appendChild(el); });
}
let dragPanelEl = null;
function panelDragAfterElement(container, x, y) {
  const els = [...container.querySelectorAll(":scope > .panel:not(.dragging)")];
  let closest = null, closestDist = Infinity, insertAfter = false;
  els.forEach((el) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < closestDist) { closestDist = dist; closest = el; insertAfter = x > cx || y > cy + box.height / 4; }
  });
  if (!closest) return null;
  return insertAfter ? closest.nextElementSibling : closest;
}
function wirePanelDrag(parent, scopeKey) {
  // dragstart/dragend는 전역(initPanelManager)에서 처리 — 여기선 같은 부모 내 순서 변경(dragover/drop)만.
  parent.addEventListener("dragover", (e) => {
    if (!dragPanelEl || dragPanelEl.parentElement !== parent) return;
    e.preventDefault();
    const after = panelDragAfterElement(parent, e.clientX, e.clientY);
    if (after == null) parent.appendChild(dragPanelEl); else parent.insertBefore(dragPanelEl, after);
  });
  parent.addEventListener("drop", (e) => {
    if (!dragPanelEl || dragPanelEl.parentElement !== parent) return;
    e.preventDefault();
    panelOrder[scopeKey] = [...parent.children].filter((c) => c.classList.contains("panel")).map((c) => c.dataset.pkey).filter(Boolean);
    savePanelOrder();
  });
}
// 크기 조절 — 한 행 6칸 열 격자 스냅(span 2~6 = 3~1개/행), 세로는 행 단위. 드래그 중 N×M 배지 표시.
let panelSize = {};
const PANEL_COLS = 6, PANEL_ROW = 60;
const P_MIN_COLS = 2, P_MAX_COLS = 6, P_MIN_ROWS = 5;
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const widthForCols = (c) => `calc(${c} * (100% - ${PANEL_COLS - 1}rem) / ${PANEL_COLS} + ${c - 1}rem)`;
// 카드 안 차트를 카드 높이에 맞춰 채움(명시적 높이가 있을 때만). 스타일 반영 뒤 한 프레임 지나 리사이즈.
function fitPanelChart(panel) {
  const explicitH = !!panel.style.height;
  panel.querySelectorAll(".chart").forEach((chart) => {
    if (explicitH) {
      chart.style.minHeight = "0";
      const h = panel.clientHeight - chart.offsetTop - 10;
      if (h > 80) chart.style.height = h + "px";
    } else { chart.style.height = ""; chart.style.minHeight = ""; }
  });
  requestAnimationFrame(() => resizePanel(panel));
}
const _panelRO = ("ResizeObserver" in window)
  ? new ResizeObserver((entries) => entries.forEach((e) => fitPanelChart(e.target)))
  : null;
function savePanelSize() {
  fetch("api/panel-size", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(panelSize) })
    .catch((e) => console.error("panel-size 저장 실패", e));
}
function enablePanelResize(panel) {
  if (panel.dataset.resizable) return;
  panel.dataset.resizable = "1";
  const key = panel.dataset.pkey || (panel.dataset.pkey = panelKey(panel) || "");
  const saved = key && panelSize[key];
  if (saved) {
    if (saved.cols) { panel.style.flex = "0 0 auto"; panel.style.width = widthForCols(clampI(saved.cols, P_MIN_COLS, P_MAX_COLS)); }
    if (saved.rows) panel.style.height = (clampI(saved.rows, P_MIN_ROWS, 99) * PANEL_ROW) + "px";
  }
  if (_panelRO) _panelRO.observe(panel);
  const handle = document.createElement("div"); handle.className = "panel-resizer"; handle.title = "드래그해서 크기 조절(격자 스냅)";
  panel.appendChild(handle);
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const wasDraggable = panel.draggable; panel.draggable = false;   // 리사이즈 중엔 카드 재정렬 드래그 차단
    const rect = panel.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY, startW = rect.width, startH = rect.height;
    const container = panel.parentElement, GAP = remPx();
    const W = container ? container.clientWidth : startW;
    const colUnit = (W - (PANEL_COLS - 1) * GAP) / PANEL_COLS;
    const badge = document.createElement("div"); badge.className = "panel-size-badge";
    panel.appendChild(badge);
    let cols = P_MIN_COLS, rows = P_MIN_ROWS;
    const apply = (ev) => {
      const dw = startW + (ev.clientX - startX), dh = startH + (ev.clientY - startY);
      cols = clampI(Math.round((dw + GAP) / (colUnit + GAP)), P_MIN_COLS, P_MAX_COLS);
      rows = clampI(Math.round(dh / PANEL_ROW), P_MIN_ROWS, 99);
      panel.style.flex = "0 0 auto"; panel.style.width = widthForCols(cols); panel.style.height = (rows * PANEL_ROW) + "px";
      badge.textContent = `${cols} × ${rows}`;
    };
    apply(e);
    const onMove = (ev) => apply(ev);
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove); handle.removeEventListener("pointerup", onUp);
      badge.remove(); panel.draggable = wasDraggable;
      const k = panel.dataset.pkey; if (k) { panelSize[k] = { cols, rows }; savePanelSize(); }
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });
}
function enablePanelReorder(container) {
  if (!container) return;
  const panels = [...container.querySelectorAll(".panel")];
  if (!panels.length) return;
  panels.forEach((p) => {   // 모든 패널: 크기조절 + 드래그 + 숨김상태 반영 + 관리목록 등록
    p.dataset.pkey = p.dataset.pkey || panelKey(p) || "";
    registerPanel(p);
    if (p.dataset.pkey && panelHidden[p.dataset.pkey]) p.style.display = "none";
    // ⚠️ 카드 전체를 draggable 로 두면 **본문 위 드래그가 텍스트 선택을 가로챈다** —
    //    chunk 원문·경로·수치를 복사할 수 없다. 카드 이동은 **제목 줄(h3)이나 카드 여백**에서만
    //    시작하고, 본문은 항상 선택 가능하게 둔다(카드 헤더 = 표준 드래그 핸들).
    p.draggable = false;
    p.classList.add("panel-draghandle");
    if (!p.dataset.dhWired) {
      p.dataset.dhWired = "1";
      p.addEventListener("pointerdown", (e) => {
        const h = p.querySelector(":scope > h3");
        // 여백(카드 자신) 또는 제목 줄에서 시작했을 때만 이동. 편집 모드의 h3 은 텍스트 이동이 우선한다.
        const onHandle = e.target === p || (h && h.contains(e.target) && !textEditOn());
        p.draggable = !!onHandle;
      });
      const off = () => { p.draggable = false; };
      p.addEventListener("pointerup", off);
      p.addEventListener("pointercancel", off);
      p.addEventListener("dragend", off);
    }
    p.querySelectorAll(".chart, table, select, .seg, .fig-img").forEach((el) => { el.draggable = false; });
    enablePanelResize(p);
  });
  const parents = [...new Set(panels.map((p) => p.parentElement))];
  parents.forEach((parent, gi) => {
    const kids = [...parent.children].filter((c) => c.classList.contains("panel"));
    const scopeKey = `${container.id}::pg${gi}`;
    applySavedPanelOrder(parent, scopeKey);
    if (kids.length >= 2) wirePanelDrag(parent, scopeKey);   // 순서 변경은 2개 이상일 때만
  });
}
// 카드 표시/숨김 — 편집 모드에서 페이지 밖으로 드래그하면 숨김, 왼쪽 관리 드로어에서 다시 켬.
let panelHidden = {};
const panelRegistry = {};
function tabLabel(tab) { const g = groupById(tab); return g ? g.name : tab; }
function savePanelHidden() {
  fetch("api/panel-hidden", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(panelHidden) })
    .catch((e) => console.error("panel-hidden 저장 실패", e));
}
function panelTitle(p) { const h = p.querySelector("h3"); return h ? h.textContent.trim() : (p.dataset.pkey || "(제목 없음)"); }
function tabOf(el) { const t = el.closest(".tab-panel"); return t ? t.id : ""; }
function registerPanel(p) { const key = p.dataset.pkey; if (key) panelRegistry[key] = { tab: tabOf(p), title: panelTitle(p) }; }
function hidePanel(el) {
  const key = el.dataset.pkey; if (!key) return;
  panelHidden[key] = panelRegistry[key] || { tab: tabOf(el), title: panelTitle(el) };
  el.style.display = "none";
  savePanelHidden(); renderPanelManager(); updateCardCount();
}
function hidePanelByKey(key) {
  let el = null;
  document.getElementById("main").querySelectorAll(".panel").forEach((p) => { if (p.dataset.pkey === key) el = p; });
  if (el) { hidePanel(el); return; }
  panelHidden[key] = panelRegistry[key] || { tab: "", title: key };
  savePanelHidden(); renderPanelManager(); updateCardCount();
}
function showPanel(key) {
  delete panelHidden[key];
  document.getElementById("main").querySelectorAll(".panel").forEach((p) => { if (p.dataset.pkey === key) p.style.display = ""; });
  savePanelHidden(); renderPanelManager(); updateCardCount();
  const active = document.querySelector(".tab-panel.active"); if (active) deferResize(active);
}
function updateCardCount() { const n = Object.keys(panelHidden).length, b = document.getElementById("cardHiddenCount"); if (b) b.textContent = n; }
let _globalDragWired = false;
function initPanelManager() {
  Object.entries(panelHidden).forEach(([k, v]) => { if (!panelRegistry[k]) panelRegistry[k] = v; });   // 숨김 카드는 탭 미방문이어도 목록에 뜨게
  if (!_globalDragWired) {
    _globalDragWired = true;
    document.addEventListener("dragstart", (e) => {
      const p = e.target.closest(".panel"); if (p && p.draggable) { dragPanelEl = p; p.classList.add("dragging"); }
    });
    document.addEventListener("dragend", (e) => {
      if (!dragPanelEl) return;
      const el = dragPanelEl; el.classList.remove("dragging"); dragPanelEl = null;
      if (!textEditOn()) return;   // 편집 모드에서만 밖으로 빼면 숨김(보기 모드에선 순서변경만)
      const main = document.getElementById("main"), r = main.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside && (e.clientX || e.clientY)) hidePanel(el);
    });
  }
  // 카드 관리 드로어(오른쪽 — "✎ 편집" 모드에서 열림, 별도 버튼 없음)
  const pop = document.createElement("div"); pop.className = "trash-pop"; pop.id = "cardPop";
  pop.innerHTML = `<div class="pin-pop-top"><b>표시 관리 <b id="cardHiddenCount" style="color:var(--faint)">0</b> 카드 · <b id="tabHiddenCount" style="color:var(--faint)">0</b> 탭</b></div>
    <p class="note" style="margin-top:0">카드는 페이지 밖으로, 탭은 탭바 밖이나 휴지통으로 드래그하면 지워집니다. 지운 것은 <b>24시간</b> 안에 여기서 복원할 수 있어요.</p>
    <div id="cardList" style="margin-top:.6rem"></div>`;
  document.body.append(pop);
  updateCardCount();
}
function renderPanelManager() {
  const host = document.getElementById("cardList"); if (!host) return;
  const all = { ...panelRegistry };
  Object.entries(panelHidden).forEach(([k, v]) => { if (!all[k]) all[k] = v; });
  const byTab = {};
  Object.entries(all).forEach(([k, v]) => { (byTab[v.tab] = byTab[v.tab] || []).push({ key: k, title: v.title }); });
  const order = (CFG.groups || []).map((g) => g.id);
  const rank = (t) => { const i = order.indexOf(t); return i < 0 ? order.length : i; };   // 모르는 탭은 맨 뒤
  const tabs = Object.keys(byTab).sort((a, b) => rank(a) - rank(b));
  // ── 탭 관리 — 드래그로 지운 탭을 되살리는 유일한 통로다. 목록은 DOM에서 파생하므로 새 탭이 생겨도 자동으로 잡힌다.
  const liveLabel = (sel, id, fb) => { const b = document.querySelector(`${sel}[${id.k}="${CSS.escape(id.v)}"]`); const t = b && b.textContent.trim(); return t || fb || id.v; };
  const navMgr = NAV.length ? `<div class="card-grp"><div class="card-grp-h">상위 섹션</div>${
    NAV.filter((n) => !(navHidden[n.id] && navHidden[n.id].purged)).map((n) => {
      const off = !!navHidden[n.id];
      return `<div class="card-row${off ? " off" : ""}" data-nav="${esc(n.id)}">
        <span class="card-name">${esc(liveLabel("#tabs button", { k: "data-nav", v: n.id }, n.name))}</span>
        <button class="nav-toggle" type="button">${off ? "복원" : "삭제"}</button>${off ? `<button class="nav-purge" type="button" title="복원 불가로 완전 삭제">완전삭제</button>` : ""}</div>`;
    }).join("")}</div>` : "";
  const subMgr = NAV.map((n) => {
    const rows = n.groups.filter((g) => !(groupHidden[g] && groupHidden[g].purged));
    if (!rows.length) return "";
    return `<div class="card-grp"><div class="card-grp-h">${esc(n.name)} · 하위 탭</div>${
      rows.map((g) => {
        const off = !!groupHidden[g];
        return `<div class="card-row${off ? " off" : ""}" data-group="${esc(g)}">
          <span class="card-name">${esc(liveLabel("#subtabs button", { k: "data-tab", v: g }, tabLabel(g)))}</span>
          <button class="grp-toggle" type="button">${off ? "복원" : "삭제"}</button>${off ? `<button class="grp-purge" type="button" title="복원 불가로 완전 삭제">완전삭제</button>` : ""}</div>`;
      }).join("")}</div>`;
  }).join("");
  host.innerHTML = navMgr + subMgr + (tabs.length ? tabs.map((tab) => `
    <div class="card-grp"><div class="card-grp-h">${esc(tabLabel(tab))}</div>
      ${byTab[tab].map((c) => {
        const hidden = !!panelHidden[c.key];
        return `<div class="card-row${hidden ? " off" : ""}" data-key="${esc(c.key)}">
          <span class="card-name">${esc(c.title)}</span>
          <button class="card-toggle" type="button">${hidden ? "표시" : "숨김"}</button></div>`;
      }).join("")}
    </div>`).join("") : `<div class="empty">아직 표시된 카드가 없습니다<span>탭을 열면 그 탭의 카드가 목록에 나타납니다</span></div>`);
  host.querySelectorAll(".card-toggle").forEach((b) => b.onclick = (e) => {
    const key = e.target.closest(".card-row").dataset.key;
    if (panelHidden[key]) showPanel(key); else hidePanelByKey(key);
  });
  host.querySelectorAll(".nav-toggle").forEach((b) => b.onclick = (e) => {
    const id = e.target.closest(".card-row").dataset.nav;
    if (navHidden[id]) showNav(id); else hideNav(id);
  });
  host.querySelectorAll(".grp-toggle").forEach((b) => b.onclick = (e) => {
    const id = e.target.closest(".card-row").dataset.group;
    if (groupHidden[id]) showGroup(id); else hideGroup(id);
  });
  host.querySelectorAll(".nav-purge").forEach((b) => b.onclick = (e) => purgeNav(e.target.closest(".card-row").dataset.nav));
  host.querySelectorAll(".grp-purge").forEach((b) => b.onclick = (e) => purgeGroup(e.target.closest(".card-row").dataset.group));
}

// ═══════════════ 서술형 텍스트 편집 — 더블클릭 수정 + 편집모드에서 추가·숨김·이동(부모 넘는 드래그) ═══════════════
// 렌더가 innerHTML을 갈아치우므로, 위치 기반 안정키(컨테이너ID::원본순번)로 오버라이드·숨김·이동·추가를 저장 후 매 렌더 재적용.
const NARRATIVE_SELECTOR = ".kicker, .mast-title h1, .lede, .sec-head h2, .sec-head p, .group-head h2, .group-head p, .expbrief .eb-v, .panel h3, .sub, .note, .tabs button[data-nav], .subtabs button[data-tab], .e2t-edit, .e1-lab-edit, .g6-claim, .g6-imp, .g6-lead, .g6-note, .g6-def, .g7-claim, .g7-imp, .g7-lead, .g7-note, .g7-def, .gx-claim, .gx-head, .gx-body, .gx-imp, .gx-note, .da-mclaim, .da-mimp, .da-pre, .da-sec, .da-subtab, .da-ddef, .da-seg button, .da-msl, .dv-seg button, .dv-tgl";
let textOverrides = {};
let hiddenText = {};    // { tid: true }
let textMoves = [];     // [ {tid, ref, pos} ] — 기준 요소 앞/뒤 이동(부모 넘어도 됨), 조작 순서대로 재생
let userText = {};      // { cid: [ {id, after, text} ] } — 사용자 추가 문단
let textStyles = {};    // { tid: {size?: "s|l|xl", color?: "acc|acc2|good|violet|blue"} } — 프리셋 선택 결과(저장됨)
const TS_CLASSES = { s: "ts-s", l: "ts-l", xl: "ts-xl" };
const TC_CLASSES = { acc: "tc-acc", acc2: "tc-acc2", good: "tc-good", violet: "tc-violet", blue: "tc-blue" };
function applyTextStyle(el) {
  // 요소의 "원래" 크기를 첫 데코 시점(프리셋 클래스 없음)에 캡처 — 배율 기준. em 기준이면 제목(h2 등)에 "크게"가 오히려 줄어드는 버그.
  if (!el.dataset.tfs) el.dataset.tfs = getComputedStyle(el).fontSize;
  el.style.setProperty("--tfs", el.dataset.tfs);
  const st = textStyles[el.dataset.tkey] || {};
  Object.values(TS_CLASSES).forEach((c) => el.classList.remove(c));
  Object.values(TC_CLASSES).forEach((c) => el.classList.remove(c));
  if (st.size && TS_CLASSES[st.size]) el.classList.add(TS_CLASSES[st.size]);
  if (st.color && TC_CLASSES[st.color]) el.classList.add(TC_CLASSES[st.color]);
}
function setTextStyle(el, patch) {
  const key = el.dataset.tkey; if (!key) return;
  const st = { ...(textStyles[key] || {}), ...patch };
  if (!st.size) delete st.size;
  if (!st.color) delete st.color;
  if (Object.keys(st).length) textStyles[key] = st; else delete textStyles[key];
  applyTextStyle(el); saveTextLayout();
}
const textEditOn = () => document.body.classList.contains("text-edit-on");
// 편집모드에선 편집가능 버튼의 클릭 '액션'을 막는다 — 클릭이 재렌더/전환을 일으켜 버튼이 사라지면 dblclick(rename)이 완성 못 됨.
document.addEventListener("click", (e) => {
  if (!textEditOn()) return;
  const b = e.target.closest("button.editable-text");
  if (b && !b.isContentEditable) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
function saveTextOverrides() {
  fetch("api/text-overrides", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(textOverrides) })
    .catch((e) => console.error("text-overrides 저장 실패", e));
}
function saveTextLayout() {
  fetch("api/text-layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden: hiddenText, moves: textMoves, added: userText, styles: textStyles }) })
    .catch((e) => console.error("text-layout 저장 실패", e));
}
function tkHash(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = (h * 33 + t.charCodeAt(i)) >>> 0; return h.toString(36); }
function applyTextEditing(container) {
  if (!container) return;
  const cid = container.id;
  const els = [...container.querySelectorAll(NARRATIVE_SELECTOR)].filter((el) => !el.classList.contains("user-text"));
  const seen = {};
  els.forEach((el, i) => {
    let key = el.dataset.tkey;   // 이미 키가 있으면 유지(내용이 바뀌어도 같은 요소)
    if (!key) {
      const base = tkHash(el.textContent.trim().slice(0, 60) || String(i));
      seen[base] = (seen[base] || 0) + 1;
      key = `${cid}::t${base}${seen[base] > 1 ? "_" + seen[base] : ""}`;
    }
    el.dataset.tkey = key;
    if (textOverrides[key] != null && el.textContent.trim() !== textOverrides[key]) el.textContent = textOverrides[key];
    if (!isNavBtn(el)) {   // 탭 버튼은 이름만 편집 — 숨김은 구조(navGroups·tab-order) 소관
      el.style.display = (hiddenText[key] && !textEditOn()) ? "none" : "";   // 편집모드에선 숨긴 것도 흐리게 보여 되살릴 수 있게
      el.classList.toggle("te-hidden", !!hiddenText[key]);
    }
    el.classList.add("editable-text");
    applyTextStyle(el);
    if (!el.dataset.teWired) {   // 리스너는 요소당 한 번만
      el.dataset.teWired = "1";
      el.addEventListener("dblclick", startTextEdit);
      el.addEventListener("dragstart", onTextDragStart);
      el.addEventListener("dragover", onTextDragOver);
      el.addEventListener("dragend", onTextDragEnd);
    }
    decorateTextEl(el);
  });
  renderUserText(container, cid);
  applyTextMoves(container);
}
// 탭 버튼의 위치·표시는 navGroups·tab-order.json이 정하는 구조다. 텍스트 레이어의 이동·숨김이
// 여기에 손대면 하위 버튼이 .subrow 밖으로 끌려나와 2단 네비가 통째로 깨진다(옛 1단 시절 기록이 실제로 그랬음).
const isNavBtn = (el) => el.matches("#tabs button[data-nav], #subtabs button[data-tab]");
function applyTextMoves(container) {
  textMoves.forEach(({ tid, ref, pos }) => {
    const el = container.querySelector(`[data-tkey="${CSS.escape(tid)}"]`);
    const anchor = container.querySelector(`[data-tkey="${CSS.escape(ref)}"]`);
    if (!el || !anchor || anchor === el) return;
    if (isNavBtn(el) || isNavBtn(anchor)) return;
    anchor.parentElement.insertBefore(el, pos === "after" ? anchor.nextSibling : anchor);
  });
}
function recordTextMove(el) {
  const tid = el.dataset.tkey; if (!tid) return;
  let ref = null, pos = null;
  let prev = el.previousElementSibling; while (prev && !prev.dataset.tkey) prev = prev.previousElementSibling;
  if (prev) { ref = prev.dataset.tkey; pos = "after"; }
  else {
    let next = el.nextElementSibling; while (next && !next.dataset.tkey) next = next.nextElementSibling;
    if (next) { ref = next.dataset.tkey; pos = "before"; }
  }
  textMoves = textMoves.filter((m) => m.tid !== tid);
  if (ref) textMoves.push({ tid, ref, pos });
  saveTextLayout();
}
// 편집모드일 때 draggable + 클래스만 부여(삭제는 공유 플로팅 툴바). 탭 버튼은 이름수정만 — 드래그·삭제 제외.
function decorateTextEl(el) {
  const on = textEditOn(), movable = on && el.tagName !== "BUTTON";
  // 상단 탭 버튼은 드래그 재정렬(wireTabReorder)이 draggable을 관리 — 텍스트 시스템이 덮어쓰지 않게 제외.
  if (!(el.matches && el.matches('.tabs button[data-nav], .subtabs button[data-tab]'))) el.draggable = movable && !el.isContentEditable;
  el.classList.toggle("te-on", movable);
}
function deleteTextEl(el) {
  // 탭 버튼은 텍스트가 아니라 **구조**다 — 텍스트 숨김(text-layout)이 아니라 전용 저장소로 보낸다.
  // 예전엔 여기서 그냥 return 해서, 휴지통에 떨궈도 아무 일이 없었다(그리고 새로고침하면 그대로였다).
  if (isNavBtn(el)) {
    if (el.dataset.nav) hideNav(el.dataset.nav); else if (el.dataset.tab) hideGroup(el.dataset.tab);
    return;
  }
  if (el.dataset.utid) {   // 사용자 추가 문단 → 완전 삭제
    const cid = (el.closest(".tab-panel") && el.closest(".tab-panel").id) || "masthead";
    userText[cid] = (userText[cid] || []).filter((x) => x.id !== el.dataset.utid); el.remove();
  } else {                 // 원본 텍스트 → 숨김 토글(편집모드에서 다시 눌러 되살림)
    const k = el.dataset.tkey;
    if (hiddenText[k]) delete hiddenText[k]; else hiddenText[k] = true;
    el.classList.toggle("te-hidden", !!hiddenText[k]);
    el.style.display = (hiddenText[k] && !textEditOn()) ? "none" : "";
  }
  saveTextLayout();
}
let dragTextEl = null;
function onTextDragStart(e) {
  if (!textEditOn()) { e.preventDefault(); return; }
  dragTextEl = e.currentTarget; e.dataTransfer.effectAllowed = "move";
  e.stopPropagation();   // 카드 드래그와 섞이지 않게
  dragTextEl.classList.add("te-dragging");
  const _tz = document.getElementById("textTrash"); if (_tz) _tz.classList.add("show");
}
function onTextDragOver(e) {
  if (!dragTextEl) return;
  const over = e.currentTarget;
  if (over === dragTextEl) return;   // 부모 제한 없음 — 어느 텍스트 앞/뒤로든 이동
  e.preventDefault(); e.stopPropagation();
  const box = over.getBoundingClientRect();
  const after = e.clientY > box.top + box.height / 2;
  over.parentElement.insertBefore(dragTextEl, after ? over.nextSibling : over);
}
function onTextDragEnd(e) {
  if (!dragTextEl) return;
  const el = dragTextEl; dragTextEl = null;
  el.classList.remove("te-dragging");
  const tz = document.getElementById("textTrash");
  let trashed = false;
  if (tz) {
    const r = tz.getBoundingClientRect();
    trashed = !!e && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    tz.classList.remove("show", "hot");
  }
  if (trashed) deleteTextEl(el);   // 휴지통에 드롭 = 삭제(원본은 숨김 처리 → ↩로 복원 가능, 추가 문단은 제거)
  else recordTextMove(el);
}
function renderUserText(container, cid) {
  container.querySelectorAll(".user-text").forEach((el) => el.remove());
  (userText[cid] || []).forEach((b) => {
    const anchor = container.querySelector(`[data-tkey="${CSS.escape(b.after)}"]`);
    const host = anchor ? anchor.parentElement : container;
    const el = document.createElement("p");
    el.className = "sub user-text editable-text"; el.dataset.utid = b.id; el.dataset.tkey = "u:" + b.id;
    el.textContent = b.text || "";
    el.draggable = textEditOn();
    el.classList.toggle("te-on", textEditOn());
    applyTextStyle(el);
    el.addEventListener("dblclick", startUserTextEdit);
    el.addEventListener("dragstart", onTextDragStart);
    el.addEventListener("dragover", onTextDragOver);
    el.addEventListener("dragend", onTextDragEnd);
    if (anchor && anchor.nextSibling) host.insertBefore(el, anchor.nextSibling); else host.appendChild(el);
  });
}
function startUserTextEdit(e) {
  const el = e.currentTarget; if (el.isContentEditable) return;
  const cid = el.closest(".tab-panel") ? el.closest(".tab-panel").id : "masthead";
  const before = el.textContent;
  el.contentEditable = "true"; el.classList.add("editing"); el.focus();
  const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const onKey = (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); el.blur(); } else if (ev.key === "Escape") { ev.preventDefault(); el.textContent = before; el.blur(); } };
  const finish = () => {
    el.contentEditable = "false"; el.classList.remove("editing");
    el.removeEventListener("blur", finish); el.removeEventListener("keydown", onKey);
    const text = el.textContent.trim();
    const b = (userText[cid] || []).find((x) => x.id === el.dataset.utid);
    if (b && b.text !== text) { b.text = text; saveTextLayout(); }
  };
  el.addEventListener("blur", finish); el.addEventListener("keydown", onKey);
}
function addUserText() {
  const active = document.querySelector(".tab-panel.active"); if (!active) return;
  const cid = active.id;
  const els = [...active.querySelectorAll("[data-tkey]")];
  const after = els.length ? els[els.length - 1].dataset.tkey : "";
  const b = { id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), after, text: "새 텍스트" };
  (userText[cid] = userText[cid] || []).push(b);
  saveTextLayout();
  applyTextEditing(active);
  const el = active.querySelector(`[data-utid="${b.id}"]`); if (el) el.dispatchEvent(new MouseEvent("dblclick"));
}
function startTextEdit(e) {
  const el = e.currentTarget;
  if (el.tagName === "BUTTON" && !textEditOn()) return;   // 버튼은 편집모드에서만 rename (일반 사용 중 더블클릭 오작동 방지)
  if (el.isContentEditable) return;
  const before = el.textContent;
  el.draggable = false;   // 편집 중엔 드래그 끔(텍스트 선택 방해 방지)
  el.contentEditable = "true"; el.classList.add("editing"); el.spellcheck = false;
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const onKey = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
    else if (ev.key === "Escape") { ev.preventDefault(); el.textContent = before; el.blur(); }
    else if (ev.key === " " && el.tagName === "BUTTON") {
      // <button>은 contentEditable이어도 스페이스를 "버튼 활성화"로 가로채 입력이 씹힘 — 직접 삽입
      ev.preventDefault();
      const sel = getSelection(); if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0); range.deleteContents();
      const node = document.createTextNode(" "); range.insertNode(node);
      range.setStartAfter(node); range.setEndAfter(node);
      sel.removeAllRanges(); sel.addRange(range);
    }
  };
  const finish = () => {
    el.contentEditable = "false"; el.classList.remove("editing");
    el.removeEventListener("blur", finish); el.removeEventListener("keydown", onKey);
    decorateTextEl(el);
    const text = el.textContent.trim();
    if (text !== before.trim()) {
      textOverrides[el.dataset.tkey] = text; saveTextOverrides();
      if (el.matches(".mast-title h1")) syncTabTitle();   // 제목 수정 → 탭 이름도 갱신
    }
  };
  el.addEventListener("blur", finish);
  el.addEventListener("keydown", onKey);
}
function refreshTextTools() { document.querySelectorAll(".editable-text").forEach(decorateTextEl); }
let teToolbarTarget = null;
function initTextEditor() {
  // 통합 "✎ 편집" 버튼 — 텍스트 편집(수정·숨김·이동·추가) + 카드 표시관리가 함께 켜지는 편집 모드. Esc로 종료.
  const fab = document.createElement("button"); fab.className = "tab-btn te-fab"; fab.type = "button";
  fab.innerHTML = `✎ 편집`;
  const addBtn = document.createElement("button"); addBtn.className = "tab-btn te-add"; addBtn.type = "button";
  addBtn.textContent = "＋ 문단"; addBtn.style.display = "none";
  const tb = document.createElement("div"); tb.className = "te-toolbar"; tb.id = "teToolbar"; tb.style.display = "none";
  tb.innerHTML = `
    <span class="te-group te-sizes">
      <button class="te-sz" data-size="s" title="작게">가</button>
      <button class="te-sz" data-size="" title="기본 크기">가</button>
      <button class="te-sz" data-size="l" title="크게">가</button>
      <button class="te-sz" data-size="xl" title="아주 크게">가</button>
    </span>
    <span class="te-group te-colors">
      <button class="te-col" data-color="" title="기본색"></button>
      <button class="te-col" data-color="acc" title="주황"></button>
      <button class="te-col" data-color="acc2" title="빨강"></button>
      <button class="te-col" data-color="good" title="초록"></button>
      <button class="te-col" data-color="violet" title="보라"></button>
      <button class="te-col" data-color="blue" title="파랑"></button>
    </span>
    <button class="te-restore" type="button" title="이 텍스트 복원">↩</button>`;
  tabActions().append(addBtn, fab); document.body.append(tb);
  // 텍스트 드래그 삭제용 휴지통 드롭존 — 텍스트를 끄는 동안만 오른쪽 위에 나타남
  const tz = document.createElement("div"); tz.id = "textTrash";
  tz.innerHTML = `🗑<span>여기에 놓으면 삭제</span>`;
  document.body.append(tz);
  tz.addEventListener("dragover", (e) => { e.preventDefault(); tz.classList.add("hot"); });
  tz.addEventListener("dragleave", () => tz.classList.remove("hot"));
  const markToolbar = (el) => {   // 현재 텍스트의 프리셋 상태를 툴바에 표시
    const st = textStyles[el.dataset.tkey] || {};
    tb.querySelectorAll(".te-sz").forEach((b) => b.classList.toggle("active", (st.size || "") === b.dataset.size));
    tb.querySelectorAll(".te-col").forEach((b) => b.classList.toggle("active", (st.color || "") === b.dataset.color));
    tb.querySelector(".te-restore").style.display = el.classList.contains("te-hidden") ? "" : "none";
  };
  tb.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("button"); if (!b || !teToolbarTarget) return;
    if (b.classList.contains("te-restore")) { deleteTextEl(teToolbarTarget); markToolbar(teToolbarTarget); return; }   // 숨김 해제(복원)
    if (b.classList.contains("te-sz")) setTextStyle(teToolbarTarget, { size: b.dataset.size });
    else if (b.classList.contains("te-col")) setTextStyle(teToolbarTarget, { color: b.dataset.color });
    markToolbar(teToolbarTarget);
  });
  // mousemove — mouseover(진입 시 1회)면 × 클릭 직후 요소를 벗어났다 돌아와야만 툴바가 다시 떠서 "복원(재클릭)이 안 되는" 문제가 생김
  document.addEventListener("mousemove", (e) => {
    if (!textEditOn()) return;
    if (e.target.closest("#teToolbar")) return;   // 툴바 위에선 타겟 유지
    const el = e.target.closest(".editable-text.te-on");
    if (!el) return;
    teToolbarTarget = el;
    const r = el.getBoundingClientRect();
    markToolbar(el);
    tb.style.display = "flex";
    const w = tb.offsetWidth, top = r.top - tb.offsetHeight - 6;
    tb.style.left = `${Math.max(4, Math.min(r.right - w, innerWidth - w - 4))}px`;
    tb.style.top = `${top > 4 ? top : r.bottom + 6}px`;
  });
  const setEditMode = (on) => {
    document.body.classList.toggle("text-edit-on", on);
    fab.classList.toggle("active", on); addBtn.style.display = on ? "block" : "none";
    if (!on) { tb.style.display = "none"; teToolbarTarget = null; }
    const cardPop = document.getElementById("cardPop");
    if (cardPop) { cardPop.classList.toggle("open", on); if (on) renderPanelManager(); updateDrawerPush(); }
    refreshTextTools();
    const active = document.querySelector(".tab-panel.active"); if (active) applyTextEditing(active);
    applyTextEditing(document.getElementById("masthead"));
  };
  fab.addEventListener("click", () => setEditMode(!textEditOn()));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && textEditOn() && !(document.activeElement && document.activeElement.isContentEditable)) setEditMode(false);
  });
  addBtn.addEventListener("click", () => addUserText());
}

// ═══════════════ 인사이트 — 오른쪽 드로어에서 생성·수정·삭제·그룹·휴지통·이동(상태 재현+강조박스) ═══════════════
// ── 상태 캡처/복원 — 인사이트가 "그 순간 화면"(토글·칩·셀렉트)을 기억·재현 ──
const TOGGLE_ATTRS = ["data-k", "data-v", "data-x", "data-m", "data-r", "data-st"];
const isVisible = (el) => !!(el.offsetParent || el.getClientRects().length);
function captureState(container) {
  if (!container) return { toggles: [], chipsOn: [], selects: [] };
  const toggles = [];
  container.querySelectorAll("button.active").forEach((b) => {
    if (!isVisible(b)) return;
    for (const attr of TOGGLE_ATTRS) if (b.hasAttribute(attr)) toggles.push({ attr, val: b.getAttribute(attr) });
  });
  const chipsOn = [...container.querySelectorAll(".chip.on[data-type]")].filter(isVisible).map((b) => b.getAttribute("data-type"));
  const selects = [...container.querySelectorAll("select[id]")].filter(isVisible).map((s) => ({ id: s.id, val: s.value }));
  return { toggles, chipsOn, selects };
}
function applyState(container, state) {
  if (!container || !state) return;
  (state.toggles || []).forEach(({ attr, val }) => {
    const b = container.querySelector(`button[${attr}="${CSS.escape(val)}"]`);
    if (b && !b.classList.contains("active")) b.click();
  });
  if (state.chipsOn) {
    const want = new Set(state.chipsOn);
    container.querySelectorAll(".chip[data-type]").forEach((b) => {
      const on = b.classList.contains("on"), t = b.getAttribute("data-type");
      if (want.has(t) !== on) b.click();
    });
  }
  (state.selects || []).forEach(({ id, val }) => {
    const s = container.querySelector(`#${CSS.escape(id)}`);
    if (s && s.value !== val) { s.value = val; s.dispatchEvent(new Event("change")); }
  });
}
const newPinId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pinLabel = (pin, i) => pin.title || (pin.points && pin.points[0]) || `#${i + 1}`;
function pinsOf(eid) {
  const o = DATA.insights.exp[eid] || (DATA.insights.exp[eid] = { title: eid, pins: [] });
  if (!o.pins) o.pins = [];
  return o;
}
// 새 인사이트 귀속: 현재 탭(그룹) → eid=그룹 첫 실험(키), container=그룹 섹션(상태 캡처 범위).
function currentDefaultTarget() {
  const tabBtn = document.querySelector("#subtabs button.active[data-tab]");
  if (!tabBtn) return null;
  const g = groupById(tabBtn.dataset.tab); if (!g || !g.experiments.length) return null;
  return { eid: g.experiments[0], cid: g.id };
}
function pointRowHTML(text) {
  return `<li><span class="pin-point" contenteditable="true">${esc(text)}</span><button class="pin-point-del" type="button" title="삭제">×</button></li>`;
}
// ── 강조 박스(여러 개) — 저장 시 드래그로 영역 지정, "이동" 시 빨간 박스로 잠깐 표시 ──
const clamp01 = (v) => Math.max(0, Math.min(1, v));
let boxDrafts = [];
let boxFormCid = null;
function refreshBoxRow() {
  const row = document.querySelector("#insightForm .box-set-row"); if (!row) return;
  const n = boxDrafts.length;
  row.innerHTML = `
    <button class="box-set${n ? " set" : ""}" type="button">🔲 ${n ? `박스 ${n}개 · 추가/편집` : "박스 지정"}</button>
    ${n ? `<button class="box-clear" type="button" title="박스 전체 지우기">전체 지우기</button>` : ""}`;
}
function startBoxDraw() {
  const c = boxFormCid && document.getElementById(boxFormCid);
  if (!c || !isVisible(c)) { alert("먼저 해당 화면으로 이동한 뒤 다시 시도해 주세요."); return; }
  const popEl = document.getElementById("insightsPop");
  popEl.classList.remove("open"); updateDrawerPush();
  const overlay = document.createElement("div"); overlay.className = "box-draw-overlay";
  const hint = document.createElement("div"); hint.className = "box-draw-hint";
  hint.innerHTML = `드래그로 강조 영역 추가 · 박스 클릭 시 삭제 <button class="box-done" type="button">완료</button>`;
  const rectEl = document.createElement("div"); rectEl.className = "box-draw-rect"; rectEl.style.display = "none";
  document.body.append(overlay, hint, rectEl);
  const drawSaved = () => {
    overlay.querySelectorAll(".box-draw-saved").forEach((el) => el.remove());
    const rect = c.getBoundingClientRect();
    boxDrafts.forEach((b, i) => {
      const d = document.createElement("div"); d.className = "box-draw-saved"; d.dataset.i = i; d.title = "클릭해서 삭제";
      d.style.left = `${rect.left + b.left * rect.width}px`; d.style.top = `${rect.top + b.top * rect.height}px`;
      d.style.width = `${b.width * rect.width}px`; d.style.height = `${b.height * rect.height}px`;
      overlay.appendChild(d);
    });
  };
  drawSaved();
  let sx = 0, sy = 0, dragging = false;
  const cleanup = () => {
    overlay.remove(); hint.remove(); rectEl.remove();
    document.removeEventListener("keydown", onKey);
    popEl.classList.add("open"); updateDrawerPush(); refreshBoxRow();
  };
  const onKey = (e) => { if (e.key === "Escape") cleanup(); };
  document.addEventListener("keydown", onKey);
  hint.querySelector(".box-done").addEventListener("click", cleanup);
  overlay.addEventListener("mousedown", (e) => {
    const saved = e.target.closest(".box-draw-saved");
    if (saved) { boxDrafts.splice(+saved.dataset.i, 1); drawSaved(); return; }
    dragging = true; sx = e.clientX; sy = e.clientY;
    rectEl.style.display = "block"; rectEl.style.left = `${sx}px`; rectEl.style.top = `${sy}px`; rectEl.style.width = "0px"; rectEl.style.height = "0px";
  });
  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
    rectEl.style.left = `${x}px`; rectEl.style.top = `${y}px`;
    rectEl.style.width = `${Math.abs(e.clientX - sx)}px`; rectEl.style.height = `${Math.abs(e.clientY - sy)}px`;
  });
  overlay.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false; rectEl.style.display = "none";
    const x0 = Math.min(sx, e.clientX), y0 = Math.min(sy, e.clientY), x1 = Math.max(sx, e.clientX), y1 = Math.max(sy, e.clientY);
    if (x1 - x0 > 12 && y1 - y0 > 12) {
      const rect = c.getBoundingClientRect();
      const left = clamp01((x0 - rect.left) / rect.width), top = clamp01((y0 - rect.top) / rect.height);
      boxDrafts.push({ left, top, width: clamp01((x1 - rect.left) / rect.width) - left, height: clamp01((y1 - rect.top) / rect.height) - top });
      drawSaved();
    }
  });
}
function showInsightBoxes(cid, boxes) {
  const c = document.getElementById(cid); if (!c || !boxes || !boxes.length) return;
  const rect = c.getBoundingClientRect();
  document.querySelectorAll(".insight-box-hi").forEach((el) => el.remove());
  boxes.forEach((box) => {
    const el = document.createElement("div"); el.className = "insight-box-hi";
    el.style.left = `${rect.left + window.scrollX + box.left * rect.width}px`;
    el.style.top = `${rect.top + window.scrollY + box.top * rect.height}px`;
    el.style.width = `${box.width * rect.width}px`;
    el.style.height = `${box.height * rect.height}px`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 2600);
  });
}
// ── 드로어 본체 ──
let editingInsight = null;   // null=신규 작성 중, {eid,pinId}=기존 항목 수정 중
function initInsightsDrawer() {
  const fab = document.createElement("button"); fab.className = "tab-btn ins-fab"; fab.type = "button";
  fab.innerHTML = `💡 인사이트 <b id="insightsCount">0</b>`;
  const pop = document.createElement("div"); pop.className = "trash-pop"; pop.id = "insightsPop";
  pop.innerHTML = `
    <div class="pin-pop-top"><b>인사이트</b></div>
    <div class="ins-actions-row">
      <button class="ins-new" type="button">+ 새 인사이트</button>
      <button class="ins-new-group" type="button">+ 새 그룹</button>
    </div>
    <div id="groupForm" class="ins-form">
      <input type="text" class="group-name-input" placeholder="그룹 이름" />
      <div class="pin-pop-actions">
        <button class="cancel" type="button">취소</button>
        <button class="save primary" type="button">만들기</button>
      </div>
    </div>
    <div id="insightForm" class="ins-form"></div>
    <div id="insightsList" style="margin-top:.6rem"></div>
    <button class="trash-toggle" type="button">🗑 휴지통 <b id="trashCount">0</b></button>
    <div id="trashSection" class="trash-section">
      <div id="trashList"></div>
      <button class="trash-empty" type="button">휴지통 비우기(전체 즉시 영구삭제)</button>
      <p class="note" style="margin-top:.6rem">삭제 후 24시간이 지나면(다음 접속 시 기준) 자동으로 영구 삭제됩니다.</p>
    </div>`;
  tabActions().appendChild(fab); document.body.appendChild(pop);
  fab.addEventListener("click", () => {
    const open = pop.classList.toggle("open"); if (open) renderInsightsDrawer(); updateDrawerPush();
  });
  document.addEventListener("click", (e) => {
    // composedPath — 클릭된 버튼을 지우는 핸들러 뒤에 평가돼도 "바깥 클릭"으로 오판하지 않게.
    // suppressOutsideClose — "이동"이 탭 버튼을 프로그램적으로 click()할 때 닫히지 않게.
    if (pop.classList.contains("open") && !suppressOutsideClose && !e.composedPath().includes(pop) && e.target !== fab && !fab.contains(e.target)) { pop.classList.remove("open"); updateDrawerPush(); }
  });
  pop.querySelector(".ins-new").addEventListener("click", () => openInsightForm());
  pop.querySelector(".ins-new-group").addEventListener("click", () => openGroupForm());
  const groupForm = pop.querySelector("#groupForm");
  groupForm.querySelector(".cancel").addEventListener("click", closeGroupForm);
  groupForm.querySelector(".save").addEventListener("click", submitGroupForm);
  groupForm.querySelector(".group-name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitGroupForm(); else if (e.key === "Escape") closeGroupForm();
  });
  pop.addEventListener("dragstart", onInsDragStart);
  pop.addEventListener("dragstart", onGroupDragStart);
  pop.addEventListener("dragend", onInsDragEnd);
  pop.addEventListener("dragend", onGroupDragEnd);
  pop.addEventListener("dragover", onInsDragOver);
  pop.addEventListener("dragover", onGroupDragOver);
  pop.addEventListener("drop", onInsDrop);
  pop.querySelector(".trash-toggle").addEventListener("click", () => {
    const sec = document.getElementById("trashSection");
    if (sec.classList.toggle("open")) renderTrashList();
  });
  pop.querySelector(".trash-empty").addEventListener("click", () => emptyTrash());
  pop.addEventListener("click", (e) => {
    const t = e.target, form = document.getElementById("insightForm");
    if (!form.contains(t)) return;
    if (t.classList.contains("cancel")) closeInsightForm();
    else if (t.classList.contains("pin-point-del")) {
      const li = t.closest("li"), text = li.querySelector(".pin-point") ? li.querySelector(".pin-point").innerText.trim() : "";
      li.remove();
      if (text && editingInsight) {
        const pin = pinsOf(editingInsight.eid).pins.find((p) => p.id === editingInsight.pinId);
        if (pin) { (pin.pointsTrash = pin.pointsTrash || []).push({ text, deletedAt: Date.now() }); saveInsights(); updateTrashCount(); }
      }
    }
    else if (t.classList.contains("pin-point-add")) {
      const ul = form.querySelector(".pin-points");
      ul.insertAdjacentHTML("beforeend", pointRowHTML(""));
      ul.lastElementChild.querySelector(".pin-point").focus();
    }
    else if (t.classList.contains("save")) saveInsightForm();
    else if (t.classList.contains("box-set")) startBoxDraw();
    else if (t.classList.contains("box-clear")) { boxDrafts = []; refreshBoxRow(); }
  });
  updateInsightsCount();
}
function updateInsightsCount() {
  let n = 0;
  Object.values(DATA.insights.exp || {}).forEach((o) => (o.pins || []).forEach((p) => { if (!p.deletedAt) n++; }));
  const badge = document.getElementById("insightsCount"); if (badge) badge.textContent = n;
}
function openInsightForm(eid, pinId) {
  editingInsight = pinId ? { eid, pinId } : null;
  let pin = { title: "", points: [] };
  if (pinId) { const found = pinsOf(eid).pins.find((p) => p.id === pinId); if (found) pin = found; }
  const target = pinId ? null : currentDefaultTarget();
  const form = document.getElementById("insightForm");
  if (!pinId && !target) {
    form.innerHTML = `<p class="note">이 탭에는 실험이 없어 인사이트를 만들 수 없습니다 — 실험이 있는 탭으로 이동해 주세요.</p>`;
    form.classList.add("open");
    return;
  }
  boxFormCid = pinId ? pin.container : target.cid;
  boxDrafts = pin.boxes ? pin.boxes.map((b) => ({ ...b })) : (pin.box ? [{ ...pin.box }] : []);
  const nb = boxDrafts.length;
  const pts = pin.points && pin.points.length ? pin.points : [""];
  form.innerHTML = `
    <input type="text" class="pin-title-input" placeholder="제목 (짧게)" value="${esc(pin.title || "")}" />
    <ul class="pin-points">${pts.map((p) => pointRowHTML(p)).join("")}</ul>
    <button class="pin-point-add" type="button">+ 항목 추가</button>
    <div class="box-set-row">
      <button class="box-set${nb ? " set" : ""}" type="button">🔲 ${nb ? `박스 ${nb}개 · 추가/편집` : "박스 지정"}</button>
      ${nb ? `<button class="box-clear" type="button" title="박스 전체 지우기">전체 지우기</button>` : ""}
    </div>
    <div class="pin-pop-actions">
      <button class="cancel" type="button">취소</button>
      <button class="save primary" type="button">저장</button>
    </div>`;
  form.classList.add("open");
  form.querySelector(".pin-title-input").focus();
}
function closeInsightForm() {
  editingInsight = null; boxDrafts = []; boxFormCid = null;
  const form = document.getElementById("insightForm"); if (!form) return;
  form.classList.remove("open"); form.innerHTML = "";
}
function saveInsightForm() {
  const form = document.getElementById("insightForm");
  const title = form.querySelector(".pin-title-input").value.trim();
  const points = [...form.querySelectorAll(".pin-point")].map((s) => s.innerText.trim()).filter(Boolean);
  if (!title && !points.length) { closeInsightForm(); return; }
  if (editingInsight) {
    const pin = pinsOf(editingInsight.eid).pins.find((p) => p.id === editingInsight.pinId);
    if (pin) {   // 기존 항목은 상태·귀속은 그대로, 텍스트·박스 수정 + (같은 탭에서 수정 중이면) 스크롤 위치 갱신
      pin.title = title; pin.points = points;
      delete pin.box;
      if (boxDrafts.length) pin.boxes = boxDrafts.map((b) => ({ ...b })); else delete pin.boxes;
      const curTab = document.querySelector("#subtabs button.active[data-tab]");
      if (curTab && curTab.dataset.tab === (EXP_TO_TAB[editingInsight.eid] || pin.container)) pin.scrollY = window.scrollY;
    }
  } else {
    const target = currentDefaultTarget(); if (!target) { closeInsightForm(); return; }
    const pin = { id: newPinId(), title, points, container: target.cid,
      state: captureState(document.getElementById(target.cid)), scrollY: window.scrollY };   // 스크롤 위치도 기억
    if (boxDrafts.length) pin.boxes = boxDrafts.map((b) => ({ ...b }));
    pinsOf(target.eid).pins.push(pin);
  }
  closeInsightForm();
  saveInsights(); renderInsightsDrawer(); updateInsightsCount();
}
function insightGroups() {
  return (CFG.groups || []).map((g) => ({
    name: g.name,
    exps: g.experiments.map((eid) => ({ eid, pins: pinsOf(eid).pins.filter((p) => !p.deletedAt) })),
  }));
}
// ── 사용자 정의 그룹(폴더) — 인라인 폼 생성·더블클릭 이름수정·헤더 클릭 접기·드래그 순서변경·팝업 밖 드래그로 삭제 ──
const newGroupId = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function userGroups() { return DATA.insights.userGroups || (DATA.insights.userGroups = []); }
function openGroupForm() {
  const form = document.getElementById("groupForm"); if (!form) return;
  form.classList.add("open");
  const input = form.querySelector(".group-name-input");
  input.value = ""; input.focus();
}
function closeGroupForm() {
  const form = document.getElementById("groupForm"); if (!form) return;
  form.classList.remove("open"); form.querySelector(".group-name-input").value = "";
}
function submitGroupForm() {
  const form = document.getElementById("groupForm"); if (!form) return;
  const name = form.querySelector(".group-name-input").value.trim();
  closeGroupForm();
  if (!name) return;
  userGroups().push({ id: newGroupId(), name, collapsed: false });
  saveInsights(); renderInsightsDrawer();
}
function toggleGroupCollapse(gid) {
  const g = userGroups().find((x) => x.id === gid); if (!g) return;
  g.collapsed = !g.collapsed;
  saveInsights(); renderInsightsDrawer();
}
function startGroupRename(gid) {
  const nameEl = document.querySelector(`.ins-group-name[data-gid="${gid}"]`);
  const g = userGroups().find((x) => x.id === gid);
  if (!nameEl || !g || nameEl.isContentEditable) return;
  const before = nameEl.textContent;
  nameEl.contentEditable = "true"; nameEl.classList.add("editing"); nameEl.spellcheck = false;
  nameEl.focus();
  const r = document.createRange(); r.selectNodeContents(nameEl);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  const onKey = (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); nameEl.blur(); }
    else if (ev.key === "Escape") { ev.preventDefault(); nameEl.textContent = before; nameEl.blur(); }
  };
  const finish = () => {
    nameEl.contentEditable = "false"; nameEl.classList.remove("editing");
    nameEl.removeEventListener("blur", finish); nameEl.removeEventListener("keydown", onKey);
    const text = nameEl.textContent.trim();
    if (text && text !== before.trim()) { g.name = text; saveInsights(); renderInsightsDrawer(); }
    else nameEl.textContent = before;
  };
  nameEl.addEventListener("blur", finish);
  nameEl.addEventListener("keydown", onKey);
}
function deleteGroup(gid) {
  DATA.insights.userGroups = userGroups().filter((x) => x.id !== gid);
  Object.values(DATA.insights.exp || {}).forEach((o) => (o.pins || []).forEach((p) => { if (p.groupId === gid) delete p.groupId; }));
  saveInsights(); renderInsightsDrawer();
}
let dragGroupEl = null, dragGroupId = null;
function onGroupDragStart(e) {
  const head = e.target.closest(".ins-group-head"); if (!head) return;
  const groupDiv = head.closest(".ins-group"); if (!groupDiv) return;
  dragGroupEl = groupDiv; dragGroupId = groupDiv.dataset.gid;
  groupDiv.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", dragGroupId); } catch (err) {}   // Firefox 호환
}
function groupDragAfterElement(y) {
  const groups = [...document.querySelectorAll("#insightsList > .ins-group:not(.dragging)")];
  return groups.reduce((closest, el) => {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return (offset < 0 && offset > closest.offset) ? { offset, element: el } : closest;
  }, { offset: -Infinity, element: null }).element;
}
function onGroupDragOver(e) {
  if (!dragGroupEl) return;
  const list = document.getElementById("insightsList"); if (!list || !list.contains(dragGroupEl)) return;
  e.preventDefault();
  const after = groupDragAfterElement(e.clientY);
  if (after == null) list.appendChild(dragGroupEl); else list.insertBefore(dragGroupEl, after);
}
function onGroupDragEnd(e) {
  if (!dragGroupEl) return;
  const pop = document.getElementById("insightsPop"), rect = pop.getBoundingClientRect();
  const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
  dragGroupEl.classList.remove("dragging");
  if (outside) { deleteGroup(dragGroupId); }
  else {
    const order = [...document.querySelectorAll("#insightsList > .ins-group")].map((el) => el.dataset.gid);
    DATA.insights.userGroups = order.map((gid) => userGroups().find((g) => g.id === gid)).filter(Boolean);
    saveInsights(); renderInsightsDrawer();
  }
  dragGroupEl = null; dragGroupId = null;
}
function renderInsightItem(eid, pin, idx) {
  const points = pin.points || [];
  return `<div class="ins-item" draggable="true" data-eid="${eid}" data-pin="${pin.id}" title="클릭=이동 · 드래그로 정렬/그룹 · 팝업 밖으로 빼면 삭제(휴지통)">
    <div class="ins-item-top">
      <span class="ins-idx">${idx + 1}</span>
      <b>${esc(pinLabel(pin, idx))}</b>
      <button class="ins-edit" type="button" title="수정">✎</button>
    </div>
    ${points.length ? `<ul class="ov-pins">${points.map((pt) => `<li>${esc(pt)}</li>`).join("")}</ul>` : ""}
  </div>`;
}
let dragInsightEl = null;
function onInsDragStart(e) {
  const item = e.target.closest(".ins-item"); if (!item) return;
  // 카드 어디서든 드래그 가능 — 실제 드래그가 일어나면 브라우저가 click을 발화하지 않아 "클릭=이동"과 충돌 없음
  dragInsightEl = item; item.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", item.dataset.pin); } catch (err) {}   // Firefox는 setData 없으면 드래그 시작 안 함
}
const clearDropHints = () => document.querySelectorAll(".ins-group-head.drop-hint").forEach((h) => h.classList.remove("drop-hint"));
function onInsDragEnd(e) {
  if (!dragInsightEl) return;
  const el = dragInsightEl; el.classList.remove("dragging");
  dragInsightEl = null; clearDropHints();
  // 팝업 밖에 놓으면 삭제(휴지통행) — 그룹 헤더 드래그아웃 삭제와 동일 패턴
  const pop = document.getElementById("insightsPop"), rect = pop.getBoundingClientRect();
  const outside = e && (e.clientX || e.clientY) && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom);
  if (outside) deleteInsight(el.dataset.eid, el.dataset.pin);
}
function insDragAfterElement(container, y) {
  const els = [...container.querySelectorAll(":scope > .ins-item:not(.dragging)")];
  return els.reduce((closest, el) => {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return (offset < 0 && offset > closest.offset) ? { offset, element: el } : closest;
  }, { offset: -Infinity, element: null }).element;
}
function onInsDragOver(e) {
  if (!dragInsightEl) return;
  // 그룹 헤더 위 = "이 그룹에 담기" 드롭 타겟(접혀 있어도 됨) — 하이라이트 + 자동 펼침
  const head = e.target.closest(".ins-group-head");
  if (head) {
    e.preventDefault();
    clearDropHints(); head.classList.add("drop-hint");
    head.closest(".ins-group").classList.add("open");
    return;
  }
  clearDropHints();
  const body = e.target.closest(".ins-group-body");
  const list = !body && e.target.closest("#insightsList") ? document.getElementById("insightsList") : null;
  const container = body || list; if (!container) return;
  e.preventDefault();
  const after = insDragAfterElement(container, e.clientY);
  if (after == null) container.appendChild(dragInsightEl); else container.insertBefore(dragInsightEl, after);
}
function persistInsightOrders() {
  [document.getElementById("insightsList"), ...document.querySelectorAll(".ins-group-body")].forEach((scope) => {
    if (!scope) return;
    [...scope.children].filter((el) => el.classList && el.classList.contains("ins-item")).forEach((el, i) => {
      const pin = pinsOf(el.dataset.eid).pins.find((p) => p.id === el.dataset.pin);
      if (pin) pin.order = i;
    });
  });
}
function onInsDrop(e) {
  if (!dragInsightEl) return;
  e.preventDefault();
  const head = e.target.closest(".ins-group-head");   // 헤더에 놓으면 그 그룹 맨 뒤로 담기
  if (head) head.closest(".ins-group").querySelector(".ins-group-body").appendChild(dragInsightEl);
  clearDropHints();
  const groupDiv = dragInsightEl.parentElement.closest(".ins-group");
  const pin = pinsOf(dragInsightEl.dataset.eid).pins.find((p) => p.id === dragInsightEl.dataset.pin);
  if (pin) { if (groupDiv) pin.groupId = groupDiv.dataset.gid; else delete pin.groupId; }
  persistInsightOrders();
  saveInsights(); renderInsightsDrawer();
}
// 그룹 없는 인사이트는 위에 평평하게, 사용자 그룹은 접이식 섹션으로. 번호는 각 구역 안에서 1부터.
function renderInsightsDrawer() {
  const host = document.getElementById("insightsList"); if (!host) return;
  const items = [];
  insightGroups().forEach((g) => g.exps.forEach((e) => e.pins.forEach((p) => items.push({ eid: e.eid, pin: p }))));
  if (!items.length) { host.innerHTML = `<div class="empty">✨ 아직 인사이트가 없습니다<span>위 "+ 새 인사이트"로 첫 항목을 추가해 보세요</span></div>`; return; }
  const indexed = items.map((it, i) => ({ ...it, _i: i }));
  const byOrder = (a, b) => (a.pin.order ?? a._i) - (b.pin.order ?? b._i);
  const ungrouped = indexed.filter((it) => !it.pin.groupId).sort(byOrder);
  const ungroupedHtml = ungrouped.map((it, i) => renderInsightItem(it.eid, it.pin, i)).join("");
  const groupSections = userGroups().map((g) => {
    const members = indexed.filter((it) => it.pin.groupId === g.id).sort(byOrder);
    const bodyHtml = members.length
      ? members.map((it, i) => renderInsightItem(it.eid, it.pin, i)).join("")
      : `<div class="ins-group-empty">여기로 항목을 드래그해서 담으세요.</div>`;
    return `<div class="ins-group${g.collapsed ? "" : " open"}" data-gid="${g.id}">
      <div class="ins-group-head" draggable="true" title="클릭해서 접기/펼치기 · 드래그해서 팝업 밖으로 빼면 삭제">
        <b class="ins-group-name" data-gid="${g.id}" title="더블클릭해서 이름 수정">${esc(g.name)}</b>
        <span class="ins-group-count">${members.length}</span>
      </div>
      <div class="ins-group-body">${bodyHtml}</div>
    </div>`;
  }).join("");
  host.innerHTML = (ungroupedHtml || "") + groupSections;
  host.querySelectorAll(".ins-item").forEach((it) => it.addEventListener("click", (e) => {
    if (e.target.closest(".ins-edit")) return;   // 수정 버튼 클릭은 제외 — 카드 나머지는 이동
    goApplyInsight(it.dataset.eid, it.dataset.pin);
  }));
  host.querySelectorAll(".ins-edit").forEach((b) => b.onclick = (e) => { const it = e.target.closest(".ins-item"); openInsightForm(it.dataset.eid, it.dataset.pin); });
  host.querySelectorAll(".ins-group-head").forEach((h) => h.addEventListener("click", (e) => {
    if (e.target.closest(".ins-group-name")) return;
    toggleGroupCollapse(h.closest(".ins-group").dataset.gid);
  }));
  host.querySelectorAll(".ins-group-name").forEach((el) => el.addEventListener("dblclick", (e) => { e.stopPropagation(); startGroupRename(el.dataset.gid); }));
}
// "이동": 탭 전환 → 상태 재현 → 스크롤 복원 → 강조박스 표시.
let suppressOutsideClose = false;
async function goApplyInsight(eid, pinId) {
  const pin = pinsOf(eid).pins.find((p) => p.id === pinId); if (!pin) return;
  const target = EXP_TO_TAB[eid] || pin.container;
  suppressOutsideClose = true;
  gotoTab(target);
  await ensureTab(target);   // ★ 탭 렌더(fetch+Plotly) 완료까지 대기 — 아직 안 그려진 탭에 적용되던 race 제거
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const c = document.getElementById(pin.container); if (c) applyState(c, pin.state);
    requestAnimationFrame(() => {
      suppressOutsideClose = false;
      const boxes = pin.boxes || (pin.box ? [pin.box] : null);
      if (boxes && boxes.length) {
        // 저장된 절대 scrollY는 레이아웃 변경(패널 추가 등)에 취약 — 강조박스(컨테이너 상대 위치)로 스크롤해 항상 화면에 들어오게.
        const c2 = document.getElementById(pin.container);
        if (c2) { const r = c2.getBoundingClientRect(); const y = r.top + window.scrollY + boxes[0].top * r.height - window.innerHeight * 0.3; window.scrollTo({ top: Math.max(0, y), behavior: "smooth" }); }
        setTimeout(() => showInsightBoxes(pin.container, boxes), 400);
      } else if (typeof pin.scrollY === "number") {
        window.scrollTo({ top: pin.scrollY, behavior: "smooth" });
      }
    });
  }));
}
function deleteInsight(eid, pinId) {
  const pin = pinsOf(eid).pins.find((p) => p.id === pinId); if (!pin) return;
  pin.deletedAt = Date.now();   // 휴지통행 — 24시간 뒤 자동 영구삭제
  saveInsights(); renderInsightsDrawer(); updateTrashCount(); updateInsightsCount();
}
function saveInsights() {
  return fetch("api/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(DATA.insights) })
    .then((r) => r.ok ? r.json() : Promise.reject(r.status))
    .catch((e) => console.error("insights 저장 실패", e));
}
// 구버전(exp.<id> = {title, points:[문자열]}) → pins[] 1회 변환.
function migrateInsights(ins) {
  Object.entries(ins.exp || {}).forEach(([eid, o]) => {
    if (!o.pins) {
      const pts = o.points || [];
      o.pins = pts.map((text) => ({ id: newPinId(), title: "", points: [text], container: EXP_TO_TAB[eid] || eid, state: null }));
      delete o.points;
    }
    o.pins.forEach((p) => {
      if (!p.points) { p.points = p.text ? [p.text] : []; delete p.text; }
      delete p.x; delete p.y;
    });
  });
}
// ── 휴지통(소프트 삭제) — 인사이트·개별 항목 모두 24시간 보관 후 자동 영구삭제 ──
const TRASH_MS = 24 * 60 * 60 * 1000;
function purgeOldTrash(ins) {
  const now = Date.now(); let changed = false;
  Object.values(ins.exp || {}).forEach((o) => {
    const before = (o.pins || []).length;
    o.pins = (o.pins || []).filter((p) => !(p.deletedAt && now - p.deletedAt > TRASH_MS));
    if (o.pins.length !== before) changed = true;
    o.pins.forEach((p) => {
      if (p.pointsTrash && p.pointsTrash.length) {
        const b2 = p.pointsTrash.length;
        p.pointsTrash = p.pointsTrash.filter((t) => now - t.deletedAt <= TRASH_MS);
        if (p.pointsTrash.length !== b2) changed = true;
      }
    });
  });
  return changed;
}
function trashItems() {
  const items = [];
  Object.entries(DATA.insights.exp || {}).forEach(([eid, o]) => {
    (o.pins || []).forEach((p) => {
      if (p.deletedAt) items.push({ eid, expTitle: o.title || eid, type: "pin", pin: p, label: pinLabel(p, 0), deletedAt: p.deletedAt });
      (p.pointsTrash || []).forEach((t, idx) => items.push({ eid, expTitle: o.title || eid, type: "point", pin: p, idx, label: t.text, deletedAt: t.deletedAt }));
    });
  });
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}
function updateTrashCount() {
  const n = trashItems().length, badge = document.getElementById("trashCount");
  if (badge) badge.textContent = n;
}
function restorePin(eid, pinId) {
  const o = pinsOf(eid), pin = o.pins.find((p) => p.id === pinId); if (!pin) return;
  delete pin.deletedAt;
  saveInsights(); renderInsightsDrawer(); updateInsightsCount(); renderTrashList(); updateTrashCount();
}
function restorePoint(eid, pinId, idx) {
  const o = pinsOf(eid), pin = o.pins.find((p) => p.id === pinId); if (!pin || !pin.pointsTrash) return;
  const trashed = pin.pointsTrash[idx]; if (!trashed) return;
  pin.pointsTrash.splice(idx, 1);
  pin.points = [...(pin.points || []), trashed.text];
  saveInsights(); renderInsightsDrawer(); updateInsightsCount(); renderTrashList(); updateTrashCount();
}
function renderTrashList() {
  const host = document.getElementById("trashList"); if (!host) return;
  const items = trashItems();
  if (!items.length) { host.innerHTML = `<div class="empty">휴지통이 비어 있습니다.</div>`; return; }
  host.innerHTML = items.map((it) => {
    const left = Math.max(0, TRASH_MS - (Date.now() - it.deletedAt));
    const hrs = Math.floor(left / 3600000), mins = Math.floor((left % 3600000) / 60000);
    return `<div class="trash-item">
      <div><b>${esc(it.expTitle)}</b> · ${it.type === "point" ? "항목" : "인사이트"} · ${esc(it.label || "(내용 없음)")}</div>
      <div class="trash-meta">${hrs}시간 ${mins}분 후 영구삭제<button class="trash-restore" type="button">복원</button></div>
    </div>`;
  }).join("");
  host.querySelectorAll(".trash-restore").forEach((b, i) => b.onclick = () => {
    const it = items[i];
    if (it.type === "pin") restorePin(it.eid, it.pin.id); else restorePoint(it.eid, it.pin.id, it.idx);
  });
}
function emptyTrash() {
  const items = trashItems(); if (!items.length) return;
  Object.values(DATA.insights.exp || {}).forEach((o) => {
    o.pins = (o.pins || []).filter((p) => !p.deletedAt);
    o.pins.forEach((p) => { if (p.pointsTrash) p.pointsTrash = []; });
  });
  saveInsights(); renderTrashList(); updateTrashCount(); renderInsightsDrawer(); updateInsightsCount();
}
function updateDrawerPush() {
  // 오른쪽 드로어(인사이트·카드 관리)가 열리면 콘텐츠를 왼쪽으로 밀기 — 탭 바 버튼도 같이 밀려 가려지지 않음.
  document.body.classList.toggle("drawer-open", !!document.querySelector("#insightsPop.open, #cardPop.open"));
}

boot();
