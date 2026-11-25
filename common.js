// 대시보드 공용 상수·헬퍼 — Plotly 다크테마, 색상 팔레트, 포맷터, 전역 DATA 보관, 재사용 차트 래퍼
/* ⚠️ CSS 토큰(:root)의 hex 사본이다 — Plotly 가 CSS 변수를 못 읽어 둘로 나뉘어 있다.
   **한쪽만 고치면 조용히 어긋난다.** faint 는 콘텐츠 JS 가 인라인 글자색으로도 쓰므로
   style.css 의 --faint 를 바꿀 때 여기도 같이 바꾼다(2026-09-05: AA 수정으로 #67627a → #8b8b95).
   나머지 값도 현재 토큰과 어긋나 있다(bg #2a2636 vs 실제 #0c0d12 등) — 차트 색이 바뀌므로 별도로 다룬다. */
const PALETTE = {
  text: "#e8e6f0", muted: "#9c97ad", faint: "#8b8b95", line: "#3a3547", acc: "#f0a830",
  acc2: "#e0533a", violet: "#9b6fd4", good: "#5fcf8e", bad: "#e0533a",
  blue: "#5aa9e6", bg: "#2a2636",
};
const CAT_COLOR = { "FFN-out": "#e0533a", "FFN-up": "#e8843a", "AdaLN": "#d8b53a",
  "FFN": "#5fcf8e", "ATTN": "#9b6fd4", "기타": "#7a90c0" };

const PLOT_BASE = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: PALETTE.text, family: "JetBrains Mono, Noto Sans KR, monospace", size: 12 },
  margin: { l: 56, r: 18, t: 16, b: 48 },
  dragmode: false,   // 드래그(박스 줌·팬) 비활성 — 줌 대신 카드 리사이즈로 크게 봄. hover·클릭은 유지.
  xaxis: { gridcolor: PALETTE.line, zerolinecolor: PALETTE.line },
  yaxis: { gridcolor: PALETTE.line, zerolinecolor: PALETTE.line },
  legend: { bgcolor: "rgba(0,0,0,0)", orientation: "h", y: -0.22 },
  hoverlabel: { font: { family: "JetBrains Mono, Noto Sans KR, monospace" } },
};
const PLOT_CFG = { displayModeBar: false, responsive: true, scrollZoom: false };   // 스크롤은 페이지 이동(줌 없음)
const fmt = (v, d = 3) => (v == null ? "—" : (+v).toFixed(d));

// 공용 JSON 로더 — 모듈마다 제각각이던 fetch 관용구를 하나로 통일.
//   cache:"no-store"  → 재생성한 데이터가 브라우저 캐시에 가려지지 않음(일부 탭만 옛 값 보이던 원인)
//   r.ok 확인         → 404가 HTML을 돌려줘 r.json()이 throw하는 경로 차단
//   실패는 fallback   → 한 파일이 없다고 패널 전체가 죽지 않음
async function getJSON(url, fallback = null) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return fallback;
    return await r.json();
  } catch (e) {
    return fallback;
  }
}

let DATA = {};

// 레이어 위치 태그 — single(concat)=공통[C], dual 이미지경로=[V], dual 텍스트경로=[T]
function roleTag(name) {
  if (name.startsWith("single.")) return "C";
  return /add_|to_add_out|ff_context|norm1_context/.test(name) ? "T" : "V";
}
function roleBadge(name) { const g = roleTag(name); return `<span class="rtag rtag-${g}">${g}</span>`; }

// PLOT_BASE에 부분 layout 머지 (xaxis/yaxis 깊은 머지). config로 차트별 Plotly 설정 오버라이드 가능.
function plot(id, traces, layout = {}, config = {}) {
  const L = {
    ...PLOT_BASE, ...layout,
    xaxis: { ...PLOT_BASE.xaxis, ...(layout.xaxis || {}) },
    yaxis: { ...PLOT_BASE.yaxis, ...(layout.yaxis || {}) },
    margin: { ...PLOT_BASE.margin, ...(layout.margin || {}) },
  };
  Plotly.newPlot(id, traces, L, { ...PLOT_CFG, ...config });
}

// 정방 heatmap 한 장 (z=행렬, magma) — Exp03/08/09 공용
function heatmap(id, z, opts = {}) {
  const t = {
    z, type: "heatmap", colorscale: opts.scale || "Magma",
    reversescale: !!opts.reverse, zmin: opts.zmin, zmax: opts.zmax,
    showscale: opts.showscale !== false,
    colorbar: { title: { text: opts.cbar || "", side: "right" }, thickness: 12, len: .9 },
    hovertemplate: (opts.hover || "i=%{y} → j=%{x}<br>%{z}") + "<extra></extra>",
  };
  const bare = !!opts.bare;
  plot(id, [t], {
    margin: opts.margin || (bare ? { l: 4, r: 4, t: 4, b: 4 } : { l: 42, r: 20, t: 8, b: 42 }),
    shapes: opts.shapes || [],
    xaxis: { title: opts.xt || "", scaleanchor: "y", constrain: "domain", gridcolor: "rgba(0,0,0,0)", showticklabels: !bare },
    yaxis: { title: opts.yt || "", autorange: "reversed", gridcolor: "rgba(0,0,0,0)", showticklabels: !bare },
  });
}

// 정렬 가능한 표 빌더 — cols=[{k,t,fmt?,color?}], rows=객체배열, 초기정렬키, footRow=고정 합계행(선택)
// 정렬 상태(정렬키·오름차순)는 표 id 기준으로 localStorage에 저장 — 새로고침해도 유지.
function sortableTable(elId, cols, rows, sortK, asc = false, footRow = null) {
  let el = typeof elId === "string" ? document.getElementById(elId) : elId;
  const skey = "tsort:" + (typeof elId === "string" ? elId : (el && el.id) || "");
  // 컨테이너가 <table> 이 아니면(div 등) 내부에 표를 만들어 그쪽에 그린다.
  // ⚠️ div 의 innerHTML 에 <thead>/<tbody> 를 직접 쓰면 **파싱 단계에서 테이블 태그가 버려져**
  //    글자만 남는다 — 에러가 안 나서 조용히 깨진다(v1.4.8 수정, v1.5.0 승격 때 유실됨).
  //    .tbl-wrap 도 여기서 씌운다 — 테두리·가로 스크롤이 표의 기본 골격이다.
  if (el && el.tagName !== "TABLE") {
    let t = el.querySelector("table[data-st]");
    if (!t) {
      el.innerHTML = "";
      if (!el.classList.contains("tbl-wrap") && !el.closest(".tbl-wrap")) el.classList.add("tbl-wrap");
      t = document.createElement("table");
      t.dataset.st = "1";
      el.appendChild(t);
    }
    el = t;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(skey) || "null");
    if (saved && cols.some((c) => c.k === saved.k)) { sortK = saved.k; asc = !!saved.asc; }
  } catch (e) {}
  const cell = (c, r) => {
    const v = c.fmt ? c.fmt(r[c.k], r) : (r[c.k] ?? "");
    const col = c.color ? c.color(r[c.k], r) : "";
    const cls = c.cls || (c.k === cols[0].k ? "" : "num");
    return `<td class="${cls}" ${col ? `style="color:${col}"` : ""}>${v}</td>`;
  };
  function draw() {
    rows.sort((a, b) => {
      const va = a[sortK], vb = b[sortK];
      const c = (va == null) - (vb == null) || (typeof va === "string" ? String(va).localeCompare(vb) : va - vb);
      return asc ? c : -c;
    });
    const foot = footRow ? `<tfoot><tr class="foot-row">${cols.map((c) => cell(c, footRow)).join("")}</tr></tfoot>` : "";
    // 헤더는 th 가 아니라 그 안의 button 이 받는다 — th 는 포커스를 못 받아 정렬이 마우스 전용이 된다.
    // aria-sort 는 현재 정렬 축·방향을 스크린리더에 알린다(WCAG 4.1.2).
    el.innerHTML = `<thead><tr>${cols.map((c) => {
      const on = c.k === sortK;
      return `<th data-k="${c.k}" class="th-s${on ? (asc ? " asc" : " sorted") : ""}" aria-sort="${on ? (asc ? "ascending" : "descending") : "none"}"><button type="button">${c.t}</button></th>`;
    }).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((c) => cell(c, r)).join("")}</tr>`).join("")}</tbody>${foot}`;
    el.querySelectorAll("thead th.th-s > button").forEach((btn) => btn.onclick = () => {
      const k = btn.parentElement.dataset.k; if (k === sortK) asc = !asc; else { sortK = k; asc = false; }
      try { localStorage.setItem(skey, JSON.stringify({ k: sortK, asc })); } catch (e) {}
      draw();
      // 재그린 뒤 같은 열에 포커스를 돌려준다 — 안 그러면 Enter 한 번에 포커스가 body 로 날아간다
      const back = el.querySelector(`thead th[data-k="${k}"] > button`); if (back) back.focus();
    });
  }
  draw();
}

/* ══════════ 모델 출처 막대 ══════════
   화면의 QA 수치를 만든 세 모델을 표 위에 못 박는다 — pseudo label 생성(지도를 그린 모델) · QA 생성 · QA 평가(채점).
   ⚠️ 모델명을 여기 적지 않는다. 정본은 run_exp.py(AQA_MODEL·AQA_JUDGE·AQA_DUMPDIR)이고
   `run update models_meta` 가 data/models_meta.json 으로 내보낸다. 잡을 고치면 화면이 따라온다.
   한 화면 안에서 역할이 갈리면(라벨러 축 스윕 등) 대표값을 고르지 않고 "축 · N종"으로 적는다. */
let MDL_META = null; let _mdlP = null; let _mdlTried = false;
async function mdlLoad() {
  if (MDL_META) return MDL_META;
  if (!_mdlP) _mdlP = getJSON("data/models_meta.json", null).then((d) => { _mdlTried = true; return (MDL_META = d); });
  return _mdlP;
}
function mdlCss() {
  if (document.getElementById("mdl-style")) return;
  const s = document.createElement("style"); s.id = "mdl-style";
  s.textContent = `
  .mdlbar{display:flex;flex-wrap:wrap;align-items:baseline;gap:.15rem 1.4rem;margin:0 0 1rem;padding:.5rem 0 .55rem;border-bottom:1px solid var(--line)}
  .mdlbar .mdl-s{display:flex;align-items:baseline;gap:.42rem;min-width:0}
  .mdlbar .mdl-k{font-size:.64rem;font-weight:800;letter-spacing:.04em;color:var(--muted);white-space:nowrap}   /* uppercase 금지 — 영문이 섞인 라벨이 튄다 */   /* --faint 는 이 크기에서 AA 미달(≈3.7:1) */
  .mdlbar .mdl-v{font-family:var(--mono);font-size:.82rem;font-weight:600;color:var(--text)}
  .mdlbar .mdl-v.na{color:var(--muted);font-weight:500}
  .mdlbar .mdl-v.ax{color:var(--acc)}
  .mdlbar .mdl-why{font-size:.72rem;color:var(--muted)}
  .mdlbar .mdl-n{margin-left:auto;font-size:.7rem;color:var(--muted);font-family:var(--mono);cursor:help;border-bottom:1px dotted var(--line)}
  .mdlbar .mdl-warn{font-size:.7rem;color:var(--verdict-bad,#e0674f)}
  .mdlbar.mdl-todo .mdl-v,.mdlbar.mdl-todo .mdl-why{color:var(--acc)}
  .mdlbar.mdl-line{margin:0 0 .35rem;padding:0;border-bottom:none;gap:.1rem .95rem;cursor:help}
  .mdlbar.mdl-line .mdl-k{font-size:.6rem;letter-spacing:.07em}
  .mdlbar.mdl-line .mdl-v{font-size:.74rem;font-weight:600}
  .mdlbar.mdl-line .mdl-why{font-size:.68rem}
  @media (max-width:640px){.mdlbar{gap:.15rem .9rem}}`;
  document.head.appendChild(s);
}
// sel = 잡 이름 배열 | 정규식 | {re, gen} — 이 화면이 싣는 잡을 고른다
function mdlJobs(sel) {
  const J = (MDL_META || {}).jobs || {};
  // 잡이 아닌 화면(라벨 품질 표 등)은 행을 직접 넘긴다 — {labeler:"7B"} 는 models_meta 의 표시명으로 푼다
  if (Array.isArray(sel) && sel.length && typeof sel[0] === "object") {
    const LM = (MDL_META || {}).labeler_model || {};
    return sel.map((r) => ({ job: r.job || "(직접)", ...r,
      labeler_model: r.labeler_model || LM[r.labeler] || null,
      judge_same: r.judge_same !== undefined ? r.judge_same : (!!r.gen && r.gen === r.judge) }));
  }
  if (Array.isArray(sel)) return sel.map((n) => J[n] || { job: n, missing: true });
  const re = sel instanceof RegExp ? sel : sel.re;
  const gen = sel instanceof RegExp ? null : sel.gen;
  return Object.values(J).filter((v) => re.test(v.job) && (!gen || v.gen === gen));
}
/* jobs 에서 한 역할의 값 집합을 뽑는다 — 하나면 그 값, 여러 개면 축, 없으면 이유. */
function mdlSlot(rows, key, whyKey) {
  const vals = [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();
  const whys = [...new Set(rows.map((r) => whyKey && r[whyKey]).filter(Boolean))];
  return { vals, whys };
}
/**
 * @param sel  잡 선택 (배열·정규식·{re,gen})
 * @param opt  {axis:"labeler"|"gen"|"judge", note:string, none:{labeler,gen,judge}}
 *             axis = 이 화면이 **일부러 바꾸는** 역할. 축이면 "축 · N종"이 정상이고 경고가 아니다.
 */
function mdlBar(sel, opt = {}) {
  mdlCss();
  if (typeof sel === "string") { const q = mdlParse(sel); opt = { ...q.opt, ...opt }; sel = q.sel; }   // 선언 문자열도 받는다(data-mdl 과 같은 문법)
  if (!sel) return "";
  if (!MDL_META) return `<div class="mdlbar"><span class="mdl-warn">모델 표기 불러오기 실패 — <code>run update models_meta</code></span></div>`;
  const rows = mdlJobs(sel);
  const miss = rows.filter((r) => r.missing).map((r) => r.job);
  const ok = rows.filter((r) => !r.missing);
  const slot = (key, label, whyKey) => {
    const { vals, whys } = mdlSlot(ok, key, whyKey);
    const isAxis = opt.axis === (key === "labeler_model" ? "labeler" : key);
    let v, cls = "", tip = "";
    if (!vals.length) {
      v = "—"; cls = "na"; tip = whys.join(" · ") || (opt.none || {})[key] || "이 표에는 해당 없음";
    } else if (vals.length === 1) {
      v = vals[0];
    } else {
      v = `${isAxis ? "⇅ 축" : "혼재"} · ${vals.length}종`; cls = isAxis ? "ax" : "na"; tip = vals.join(" · ");
    }
    return `<span class="mdl-s" ${tip ? `title="${tip.replace(/"/g, "&quot;")}"` : ""}>
      <span class="mdl-k">${label}</span><span class="mdl-v ${cls}">${v}</span>${cls === "na" && tip && vals.length === 0 ? `<span class="mdl-why">${tip}</span>` : ""}</span>`;
  };
  // 채점은 생성과 같은 경우가 대부분 — 같으면 "= 생성"으로 줄이되 실제 이름은 tooltip 에 남긴다
  const jv = [...new Set(ok.map((r) => r.judge).filter(Boolean))];
  const gv = [...new Set(ok.map((r) => r.gen).filter(Boolean))];
  const judgeSame = ok.length && ok.every((r) => r.judge_same);
  const judgeCell = judgeSame
    ? `<span class="mdl-s" title="${jv.join(" · ")}"><span class="mdl-k">QA 평가</span><span class="mdl-v na">= 생성</span></span>`
    : slot("judge", "QA 평가");
  const direct = ok.length && ok.every((r) => r.job === "(직접)");   // 잡이 아니라 축을 직접 넘긴 화면
  const nTip = direct ? ok.map((r) => r.labeler_model || "?").join("\n")
                      : ok.map((r) => `${r.job}: ${r.labeler_model || r.no_labeler || "?"} / ${r.gen} / ${r.judge}`).join("\n");
  // compact = 표 바로 위 한 줄(탭 상단 막대보다 작고 테두리 없음). 잡 개수 배지는 탭 막대에만.
  return `<div class="mdlbar${opt.compact ? " mdl-line" : ""}${opt.todo ? " mdl-todo" : ""}"${opt.compact ? ` title="${nTip.replace(/"/g, "&quot;")}"` : ""}>
    ${slot("labeler_model", "pseudo label 생성", "no_labeler")}
    ${slot("gen", "QA 생성")}
    ${judgeCell}
    ${opt.note ? `<span class="mdl-s"><span class="mdl-why">${opt.note}</span></span>` : ""}
    ${miss.length ? `<span class="mdl-warn">모르는 잡 ${miss.length}개: ${miss.slice(0, 3).join(", ")}</span>` : ""}
    ${opt.compact ? "" : `<span class="mdl-n" title="${nTip.replace(/"/g, "&quot;")}">${direct ? `${ok.length}종` : `잡 ${ok.length}개`} ⓘ</span>`}
  </div>`;
}

/* ══════════ 산문 접기 — 대시보드는 읽는 화면이 아니라 판단하는 화면 ══════════
   (JM 2026-08-13) 결과만 보고 다음 판단으로 넘어가는 용도라 설명 산문은 기본 안 보이게 한다.
   100자 넘는 해설 블록을 1줄로 접고(클릭 시 펼침), 내용은 DOM 에 그대로 남긴다 — 판정 근거·한계
   표기 규약과 충돌하지 않는 이유다. 탭별 클래스가 제각각(dv-sub·g8-note·da-note2 …)이라
   선택자 나열 대신 클래스 토큰 패턴으로 잡는다. 새 탭도 자동 적용된다.
   접히면 안 되는 진짜 경고(무효 판정 등)만 data-prose="keep" 을 직접 단다. */
const PROSE_MIN = 100;   // 이하 길이는 손대지 않는다(짧은 캡션은 소음이 아니다)
const PROSE_TOKEN = /^(?:[a-z0-9]+-)?(?:sub|qsub|subh|note|note2|cap|warn|hint|src|legendnote|desc|mimp|ddef)$/;   // mimp=함의·ddef=정의 산문(주장 줄 da-mclaim 은 남긴다)
function proseCss() {
  if (document.getElementById("prose-style")) return;
  const s = document.createElement("style"); s.id = "prose-style";
  s.textContent = `
  [data-prose="clamp"]{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer}
  [data-prose="open"]{cursor:pointer}
  [data-prose="clamp"]::before{content:"▸ ";color:var(--faint);font-size:.85em}
  [data-prose="open"]::before{content:"▾ ";color:var(--faint);font-size:.85em}`;
  document.head.appendChild(s);
}
function collapseProse(root) {
  if (!root) return;
  proseCss();
  const cand = root.querySelectorAll('[class]:not([data-prose])');
  cand.forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.closest("table") || el.closest("[data-prose]") || el.closest(".mdlbar,.expbrief")) return;
    if (![...el.classList].some((c) => PROSE_TOKEN.test(c))) return;
    if (el.querySelector("select,input,canvas")) return;         // 컨트롤을 품은 블록은 접으면 죽는다
    if ((el.textContent || "").trim().length <= PROSE_MIN) { el.dataset.prose = "short"; return; }
    el.dataset.prose = "clamp";
    el.title = "클릭·Enter = 설명 펼침/접힘";
    // 클릭만 걸면 마우스 전용이 된다(WCAG 2.1.1) — 포커스를 받고 Enter·Space 로도 열리게 한다.
    // ⚠️ role="button" 은 일부러 안 붙였다 — 그러면 문단 전체가 버튼 "이름" 이 되어
    //    스크린리더가 본문을 내용이 아니라 이름으로 읽는다. 여는 수단만 열어 둔다.
    el.tabIndex = 0;
    const toggle = () => { el.dataset.prose = el.dataset.prose === "clamp" ? "open" : "clamp"; };
    el.addEventListener("click", (e) => {
      if (e.target.closest("a,button")) return;                  // 본문 속 링크·버튼은 그대로 동작
      toggle();
    });
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;                               // 안쪽 링크·버튼의 키 입력은 건드리지 않는다
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}
// 서브탭 전환 등 app.js 를 거치지 않는 재렌더에도 적용 — childList 만 관찰(자기 자신은 attr 변경이라 재발화 없음)
function proseWatch() {
  if (window._proseMO) return;
  const main = document.getElementById("main");
  if (!main) return;
  let t = null;
  window._proseMO = new MutationObserver(() => {
    clearTimeout(t); t = setTimeout(() => { collapseProse(main); applyTableMdl(main); }, 200);
  });
  window._proseMO.observe(main, { childList: true, subtree: true });
}

/* 탭·패널 머리의 표준 구조 — 목표 / 세팅 각 1줄 (JM 2026-08-13, 2026-09-05 개정).
   화면 본문에 오는 것은 제목·목적·세팅 셋뿐이다. 결과·해석 줄은 뺐다 — 데이터가 갱신돼도
   문장이 따라오지 않아 화면이 조용히 거짓말을 하기 때문이다(DESIGN.md §5). 결론은 💡 인사이트로. */
function expBrief(o) {
  if (!document.getElementById("expbrief-style")) {
    const s = document.createElement("style"); s.id = "expbrief-style";
    s.textContent = `
    .expbrief{display:grid;grid-template-columns:auto 1fr;gap:.14rem .7rem;margin:.2rem 0 .9rem;font-size:.82rem}
    /* 한글 라벨이라 uppercase·letter-spacing 은 효과가 없고 0.62rem 는 읽히지 않는다 — 탭 머리의 주역이 된 뒤 크기를 올렸다 */
    .expbrief .eb-k{font-size:.72rem;font-weight:700;color:var(--muted);align-self:baseline;white-space:nowrap;padding-top:.1em}
    .expbrief .eb-v{color:var(--text);line-height:1.5;max-width:72ch;text-wrap:pretty}`;
    document.head.appendChild(s);
  }
  const rows = [["목표", o.goal], ["세팅", o.setup]];
  return `<div class="expbrief">${rows.filter(([, v]) => v)
    .map(([k, v]) => `<span class="eb-k">${k}</span><span class="eb-v">${v}</span>`).join("")}</div>`;
}

/* ── 표마다 붙는 출처 한 줄 ──────────────────────────────────────────
   탭 상단 막대만으로는 부족하다 — 한 탭 안에서도 표마다 세 모델이 다르다(예: 라벨러 탭 4개 표).
   표가 **자기 출처를 들고 있어야** 스크롤하다 만난 표를 그 자리에서 읽을 수 있다(JM 2026-08-13).

   선언은 DOM 속성으로 한다 — 표 자신 또는 조상에 `data-mdl`, 없으면 패널의 `data-mdl` 를 물려받는다.
     data-mdl="AGREEMP9,GNDMP9"          잡 이름 목록
     data-mdl="re:^FVQA"                 이름 정규식
     data-mdl="re:^RESQA|gen:Qwen3.5-9B" 정규식 + 생성 모델 한정
     data-mdl="labelers:0.8B,3B"         잡이 아니라 라벨러 축(라벨 품질 표)
     data-mdl="none:이 표는 …"            세 칸 모두 해당 없음 + 이유
   `axis:labeler` 를 덧붙이면 그 역할이 "축"으로 표시된다(대표값을 고르지 않는다). */
function mdlParse(spec) {
  // ⚠️ `|` 로 그냥 자르면 정규식 alternation(`^(BGTOK|RJFULL2)`)이 쪼개진다 — **키 앞의 `|` 만** 구분자다
  const parts = String(spec || "").split(/\|(?=(?:re|gen|axis|note|labelers|none):)/)
    .map((x) => x.trim()).filter(Boolean);
  let sel = null; const opt = {};
  for (const part of parts) {
    const i = part.indexOf(":"), k = i < 0 ? "" : part.slice(0, i), v = i < 0 ? part : part.slice(i + 1);
    if (k === "re") sel = { ...(sel && typeof sel === "object" && !Array.isArray(sel) ? sel : {}), re: new RegExp(v) };
    else if (k === "gen") sel = { ...(sel && typeof sel === "object" && !Array.isArray(sel) ? sel : {}), gen: v };
    else if (k === "labelers") sel = v.split(",").map((x) => ({ labeler: x.trim() }));
    else if (k === "none") { sel = []; opt.none = { gen: v, judge: v, labeler_model: v }; }
    // 아직 출처를 확인 못 한 표 — 추측해서 적으면 이 기능의 목적이 무너진다. 비워 두되 **눈에 띄게** 둔다.
    else if (k === "unknown" || part === "unknown") { sel = []; const w = "출처 미기입 — 확인 후 data-mdl 을 채울 것"; opt.none = { gen: w, judge: w, labeler_model: w }; opt.todo = true; }
    else if (k === "axis") opt.axis = v;
    else if (k === "note") opt.note = v;
    else sel = part.split(",").map((x) => x.trim()).filter(Boolean);   // 잡 이름 목록
  }
  return { sel, opt };
}
function mdlLine(spec) {
  const { sel, opt } = mdlParse(spec);
  if (!sel) return "";
  return mdlBar(sel, { ...opt, compact: true });
}
// 패널 안의 모든 표 위에 한 줄을 붙인다(이미 붙은 표는 건너뛴다). 표가 이미 출처 막대 안에 있으면 제외.
function applyTableMdl(root) {
  if (!root) return;
  // 선언(data-mdl)만 쓰는 탭은 렌더러가 mdlLoad 를 부르지 않는다 — 여기서 직접 불러 오고 끝나면 다시 칠한다.
  // (이게 없으면 그런 탭은 **조용히** 출처 줄이 안 붙는다. 실측: mmlbqa·mmlbimpl)
  if (!MDL_META) { if (!_mdlTried) mdlLoad().then(() => applyTableMdl(root)); return; }
  root.querySelectorAll("table:not([data-mdl-done])").forEach((t) => {
    t.dataset.mdlDone = "1";
    if (t.closest(".mdlbar,.expbrief")) return;
    const owner = t.closest("[data-mdl]");   // 표 자신 → 카드 → 패널 순으로 올라간다
    const spec = owner && owner.dataset.mdl;
    if (!spec) return;
    const html = mdlLine(spec); if (!html) return;
    // 표가 스크롤 래퍼 안에 있으면 래퍼 **바깥** 위에 — 안에 넣으면 가로 스크롤에 딸려 사라진다
    const anchor = t.closest(".dv-scroll") || t;
    anchor.insertAdjacentHTML("beforebegin", html);
  });
}

// 빈 탭을 "빈 채로" 두지 않는다 — 무엇을 물을 자리인지·왜 비었는지·무엇이 있어야 채워지는지를 화면에 적는다.
// (정본 §3-8 "못 올린 것도 같은 목록에 적는다" 의 화면판. 자리표시자 탭은 이 헬퍼 한 줄로 만든다.)
// 제목·목적은 group-head 가 이미 그린다 — 여기서 다시 그리면 한 탭에 제목이 둘이 된다.
// num·title·question 은 호출부 하위호환으로 받기만 하고 쓰지 않는다.
function emptyTab(elId, { num, title, question, why, need = [] } = {}) {
  const el = typeof elId === "string" ? document.getElementById(elId) : elId;
  if (!el) return;
  el.innerHTML = `
    <div class="panel"><h3>아직 없다</h3>
      <p class="sub">${esc(why || "이 자리에 들어갈 산출물이 아직 만들어지지 않았다.")}</p>
      ${need.length ? `<ul class="note">${need.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
}
