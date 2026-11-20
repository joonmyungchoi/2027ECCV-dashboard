// Exp 05 — Qwen3-VL-4B-Instruct 언어 디코더를 Exp 04 와 같이 재배치한 변형별 MMMU 정확도 표 · 격자 · Exp 04 NLL 과의 산점도
async function render_exp05() {
  const el = document.getElementById("exp05");
  const d = await fetch("data/exp05.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const origin = d.rows.find((r) => r.variant === "origin");
  const named = d.rows.filter((r) => r.named), sweep = d.rows.filter((r) => r.pairs != null);
  const withNll = d.rows.filter((r) => r.exp04_wikitext2_nll != null);   // 짝수 시작 칸(2026-11-20 보강분)은 Exp 04 NLL 이 없다
  el.innerHTML = `
    <div class="panel">
      <h3>이름 붙인 변형별 MMMU 정확도</h3>
      <p class="sub">${esc(d.model)} 의 언어 디코더 블록 36개를 Exp 04 와 같은 방식으로 재배치했다(가중치 변경 없음 · 시각 인코더는 그대로).
        MMMU validation 객관식 ${d.n}문항 · 문항마다 선택지 글자의 확률이 가장 높으면 맞힘. 우연 수준(문항별 1/선택지 수의 평균) ${fmt(d.chance, 4)}.
        «문항 평균» = 전체 문항 중 맞힌 비율 · «과목 평균» = 과목마다 정확도를 낸 뒤 30과목을 같은 비중으로 평균.
        «Exp 04 WikiText-2 NLL» = 같은 이름의 변형을 Qwen3-4B-Base 에서 잰 값(다른 모델). 잡 <code>${esc(d.job)}</code> · 산출물 <code>_hub/runs/05_qwen_vl_trainfree_mbt/</code>.</p>
      <div class="tbl-wrap"><table id="exp05_t"></table></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>쌍마다 평균 전수 조사 — MMMU 정확도</h3>
        <p class="sub">이웃 쌍 (s ∥ s+1) 을 연속 N쌍 평균하는 모든 경우 ${sweep.length}개 — 시작 레이어 s 는 홀수·짝수 모두(1레이어 간격 · 짝수 시작은 잡 <code>vmmmu2</code>).
          가로 = 구간의 첫 레이어, 세로 = 평균한 쌍의 수 N(순차 깊이 36 − N). 색 범위는 우연 수준 ${fmt(d.chance, 3)} ~ 원본 ${fmt(origin.mmmu_acc, 4)}.
          ${d.even && d.even.done < d.even.total ? `짝수 시작 칸은 ${d.even.done}/${d.even.total}개 반영(잡이 도는 중 · 빈 칸은 아직 안 잰 칸).` : ""}</p>
        <div id="exp05_hm" class="chart chart-lg"></div>
      </div>
      <div class="panel">
        <h3>변형별 Exp 04 WikiText-2 NLL 과 MMMU 정확도</h3>
        <p class="sub">점 하나 = Exp 04 NLL 이 있는 변형 하나(${withNll.length}개). 가로 = 같은 변형의 Exp 04 WikiText-2 NLL(Qwen3-4B-Base · 로그 축), 세로 = 이 실험의 MMMU 정확도,
          색 = 평균한 쌍의 수 N(이름 붙인 «한 번 평균» 변형은 회색). ◆ = 원본. 점선 = 우연 수준. 사전에 정한 판정(순위 상관)이 보는 관계다.</p>
        <div id="exp05_sc" class="chart chart-lg"></div>
      </div>
    </div>
    <div class="panel">
      <h3>쌍마다 평균 전수 조사 — 변형별 값</h3>
      <p class="sub">위 격자의 값 전체. 변형 이름 <code>lw_a_b</code> = 레이어 a~b 를 쌍마다 평균. 맨 아래 고정 행이 원본.</p>
      <div id="exp05_sweep_t"></div>
    </div>`;
  sortableTable("exp05_t", [
    { k: "variant", t: "변형" },
    { k: "depth", t: "순차 깊이" },
    { k: "mmmu_acc", t: "MMMU 정확도(문항 평균)", fmt: (v) => fmt(v, 4) },
    { k: "mmmu_macro", t: "MMMU 정확도(과목 평균)", fmt: (v) => fmt(v, 4) },
    { k: "exp04_wikitext2_nll", t: "Exp 04 WikiText-2 NLL", fmt: (v) => fmt(v, 4) },
  ], named, "mmmu_acc", false);

  const xs = [...Array(35)].map((_, i) => i + 1), ys = [...Array(18)].map((_, i) => i + 1);
  const z = ys.map(() => xs.map(() => null)), names = ys.map(() => xs.map(() => ""));
  for (const r of sweep) {
    z[r.pairs - 1][r.first - 1] = r.mmmu_acc;
    names[r.pairs - 1][r.first - 1] = `${r.variant} · 레이어 ${r.first}~${r.last}`;
  }
  plot("exp05_hm", [{
    type: "heatmap", x: xs, y: ys, z, customdata: names, colorscale: "Magma", xgap: 1, ygap: 1,
    zmin: d.chance, zmax: origin.mmmu_acc, hoverongaps: false,
    colorbar: { title: { text: "MMMU 정확도", side: "right" }, thickness: 12, len: .9 },
    hovertemplate: "%{customdata}<br>N=%{y}쌍<br>MMMU 정확도 %{z:.4f}<extra></extra>",
  }], {
    margin: { l: 52, r: 20, t: 8, b: 46 },
    xaxis: { title: "구간의 첫 레이어", tickvals: xs.filter((x) => x % 2), gridcolor: "rgba(0,0,0,0)" },
    yaxis: { title: "평균한 쌍의 수 N", tickvals: ys, autorange: "reversed", gridcolor: "rgba(0,0,0,0)" },
  });

  const once = d.rows.filter((r) => r.pairs == null && r.variant !== "origin");
  plot("exp05_sc", [
    { type: "scatter", mode: "markers", name: "쌍마다 평균",
      x: sweep.filter((r) => r.exp04_wikitext2_nll != null).map((r) => r.exp04_wikitext2_nll),
      y: sweep.filter((r) => r.exp04_wikitext2_nll != null).map((r) => r.mmmu_acc),
      customdata: sweep.filter((r) => r.exp04_wikitext2_nll != null).map((r) => `${r.variant} · 레이어 ${r.first}~${r.last} · N=${r.pairs}`),
      marker: { size: 8, color: sweep.filter((r) => r.exp04_wikitext2_nll != null).map((r) => r.pairs), colorscale: "Magma", cmin: 1, cmax: 18,
        line: { width: 0.5, color: PALETTE.bg },
        colorbar: { title: { text: "쌍의 수 N", side: "right" }, thickness: 12, len: .9 } },
      hovertemplate: "%{customdata}<br>Exp 04 NLL %{x:.4f}<br>MMMU %{y:.4f}<extra></extra>" },
    { type: "scatter", mode: "markers", name: "한 번 평균",
      x: once.map((r) => r.exp04_wikitext2_nll), y: once.map((r) => r.mmmu_acc), customdata: once.map((r) => r.variant),
      marker: { size: 10, color: PALETTE.muted, line: { width: 1, color: PALETTE.bg } },
      hovertemplate: "%{customdata}<br>Exp 04 NLL %{x:.4f}<br>MMMU %{y:.4f}<extra></extra>" },
    { type: "scatter", mode: "markers", name: "원본",
      x: [origin.exp04_wikitext2_nll], y: [origin.mmmu_acc],
      marker: { size: 14, symbol: "diamond", color: PALETTE.text, line: { width: 1.5, color: PALETTE.bg } },
      hovertemplate: "원본<br>Exp 04 NLL %{x:.4f}<br>MMMU %{y:.4f}<extra></extra>" },
  ], {
    showlegend: false,
    margin: { l: 56, r: 20, t: 8, b: 48 },
    xaxis: { title: "Exp 04 WikiText-2 NLL (로그 축)", type: "log" },
    yaxis: { title: "MMMU 정확도", range: [0.15, 0.65] },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: d.chance, y1: d.chance,
      line: { color: PALETTE.faint, width: 1, dash: "dot" } }],
  });

  sortableTable("exp05_sweep_t", [
    { k: "variant", t: "변형" },
    { k: "first", t: "첫 레이어" },
    { k: "last", t: "끝 레이어" },
    { k: "pairs", t: "쌍 수 N" },
    { k: "depth", t: "순차 깊이" },
    { k: "mmmu_acc", t: "MMMU 정확도(문항 평균)", fmt: (v) => fmt(v, 4) },
    { k: "exp04_wikitext2_nll", t: "Exp 04 WikiText-2 NLL", fmt: (v) => fmt(v, 4) },
  ], sweep, "mmmu_acc", false,
  { variant: "origin(원본)", first: "–", last: "–", pairs: 0, depth: 36,
    mmmu_acc: origin.mmmu_acc, exp04_wikitext2_nll: origin.exp04_wikitext2_nll });
}
