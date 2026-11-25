// Exp 08 — 순차 깊이를 줄이는 네 방법(병렬 · 지우기-앞 · 지우기-뒤 · 가중치 평균)의 인접 쌍별 정확도와 방법별 그리디(깊이 20 까지) 차트 · 표
async function render_exp08() {
  const el = document.getElementById("exp08");
  const d = await fetch("data/exp08.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const M = [["parallel", "병렬(출력 평균)", PALETTE.acc], ["erase_second", "지우기-앞(i 만 실행)", PALETTE.blue],
             ["erase_first", "지우기-뒤(i+1 만 실행)", PALETTE.violet], ["wavg", "가중치 평균", PALETTE.acc2]];
  const metric = (b) => (b.task === "mmmu" ? "MMMU" : "MMLU");
  el.innerHTML = `
    <div class="panel">
      <h3>네 방법의 35쌍 평균 정확도</h3>
      <p class="sub">인접 쌍 (i, i+1) 자리에서 순차 깊이를 36 → 35 로 줄이는 네 방법. 가중치는 학습하지 않는다.
        병렬 = 두 레이어에 같은 입력을 넣고 출력을 평균(Exp 04·05 의 N=1 칸 <code>lw_i_i+1</code> 재사용) ·
        지우기-앞 = 쌍의 앞 레이어 i 만 실행(i+1 제거 · 초안 Fig. 3 의 Select layer i) · 지우기-뒤 = 뒤 레이어 i+1 만 실행(i 제거 · Select layer i+1) ·
        가중치 평균 = 두 레이어의 모든 파라미터(어텐션 · MLP · RMSNorm 게인)를 원소별로 평균한 레이어 하나(MMMU 의 DeepStack 블록 1~3 은 시각 특징을 각 ½ 씩 더한다).
        «1등인 쌍» = 35쌍 중 그 방법의 정확도가 네 방법 중 가장 높은 쌍 수(동점은 모두 1등으로 센다).</p>
      <div class="tbl-wrap"><table id="exp08_sum"></table></div>
    </div>
    ${d.bench.map((b) => `
    <div class="panel">
      <h3>${metric(b)} — 쌍 시작 레이어별 정확도</h3>
      <p class="sub">${esc(b.model)} · ${esc(b.label)} · 로짓 채점. 가로 = 쌍 (i, i+1) 의 i. 점선 = 원본 ${fmt(b.origin, 4)}.
        잡 <code>${b.jobs.parallel}</code>(병렬) · <code>${b.jobs.ablation}</code>(지우기 · 가중치 평균) · ${b.pairs}/35쌍.</p>
      <div id="exp08_${b.task}" class="chart chart-md"></div>
    </div>`).join("")}
    ${d.bench.map((b) => `
    <div class="panel">
      <h3>${metric(b)} — 방법별 그리디로 순차 깊이를 35 → 20 까지 줄일 때</h3>
      <p class="sub">${esc(b.model)} · ${esc(b.label)}. 네 방법이 각자 제 정확도로 고른다 — 라운드마다 인접 그룹 쌍 하나를 합친 후보 전부(36 − 라운드 개)를 재고 가장 높은 것(같으면 앞 위치)을 확정해 순차 깊이를 1 씩 줄인다.
        후보는 네 방법이 같고 합친 그룹을 실행하는 방식만 다르다 — 병렬 = 그룹의 레이어 전부에 같은 입력을 넣고 출력을 평균(Exp 06 그리디) ·
        지우기-앞 = 그룹의 맨 앞 레이어만 실행 · 지우기-뒤 = 그룹의 맨 뒤 레이어만 실행 · 가중치 평균 = 그룹의 모든 레이어 파라미터를 평균한 레이어 하나.
        가로 = 순차 깊이. 점선 = 원본 ${fmt(b.origin, 4)}. 끝난 라운드만 그린다(16라운드 중 ${["parallel", "first", "last", "wavg"].map((m) => b.greedy.filter((r) => r[m] != null).length).join(" · ")} — 병렬 · 앞 · 뒤 · 가중치 평균 순).
        잡 <code>${b.task === "mmmu" ? "v8gf · v8gl · v8gw · v8gw2" : "t8gf · t8gl · t8gw · t8gw2"}</code>.</p>
      <div id="exp08_g_${b.task}" class="chart chart-md"></div>
    </div>`).join("")}
    <div class="panel">
      <h3>방법별 그리디 — 라운드별 확정 구성</h3>
      <p class="sub">위 차트의 값과, 그 라운드까지 지우기-앞 · 지우기-뒤가 지운(실행하지 않는) 레이어 · 가중치 평균이 합친 그룹.</p>
      <div id="exp08_gt"></div>
    </div>
    <div class="panel">
      <h3>쌍별 값</h3>
      <p class="sub">위 차트의 값 전체.</p>
      <div id="exp08_t"></div>
    </div>`;

  sortableTable("exp08_sum", [
    { k: "bench", t: "벤치마크" },
    { k: "origin", t: "원본", fmt: (v) => fmt(v, 4) },
    ...M.flatMap(([m, name]) => [{ k: m, t: name, fmt: (v) => fmt(v, 4) }]),
    ...M.map(([m, name]) => ({ k: m + "_best", t: `1등인 쌍 · ${name}` })),
  ], d.bench.map((b) => ({ bench: b.label, origin: b.origin,
    ...Object.fromEntries(M.flatMap(([m]) => [[m, b.summary[m].mean], [m + "_best", b.summary[m].best]])) })), "bench", true);

  d.bench.forEach((b) => plot(`exp08_${b.task}`, M.map(([m, name, color]) => ({
    type: "scatter", mode: "lines+markers", name, x: b.rows.map((r) => r.pair), y: b.rows.map((r) => r[m]),
    line: { color, width: 1.5 }, marker: { size: 5 },
    hovertemplate: "쌍 (%{x}, %{x}+1)<br>" + metric(b) + " %{y:.4f}<extra>" + name + "</extra>",
  })), {
    margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.1 },
    xaxis: { title: "쌍의 첫 레이어 i", dtick: 2 }, yaxis: { title: metric(b) + " 정확도" },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: b.origin, y1: b.origin, line: { color: PALETTE.faint, width: 1, dash: "dot" } }],
  }));

  const G = [["parallel", "병렬 그리디", PALETTE.acc], ["first", "지우기-앞 그리디", PALETTE.blue], ["last", "지우기-뒤 그리디", PALETTE.violet],
             ["wavg", "가중치 평균 그리디", PALETTE.acc2]];
  d.bench.forEach((b) => plot(`exp08_g_${b.task}`, G.map(([m, name, color]) => ({
    type: "scatter", mode: "lines+markers", name, x: [36, ...b.greedy.map((r) => r.depth)], y: [b.origin, ...b.greedy.map((r) => r[m])],
    line: { color, width: 2 }, marker: { size: 7 },
    hovertemplate: "순차 깊이 %{x}<br>" + metric(b) + " %{y:.4f}<extra>" + name + "</extra>",
  })), {
    margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.1 },
    xaxis: { title: "순차 깊이", autorange: "reversed", dtick: 1 }, yaxis: { title: metric(b) + " 정확도" },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: b.origin, y1: b.origin, line: { color: PALETTE.faint, width: 1, dash: "dot" } }],
  }));
  sortableTable("exp08_gt", [
    { k: "bench", t: "벤치마크" }, { k: "depth", t: "순차 깊이" },
    ...G.map(([m, name]) => ({ k: m, t: name, fmt: (v) => fmt(v, 4) })),
    { k: "first_pick", t: "지우기-앞이 지운 레이어" }, { k: "last_pick", t: "지우기-뒤가 지운 레이어" }, { k: "wavg_pick", t: "가중치 평균이 합친 그룹" },
  ], d.bench.flatMap((b, bi) => b.greedy.map((r) => ({ ...r, bench: metric(b), _i: bi * 100 + r.r }))), "_i", true);

  const [mm, mv] = d.bench;
  sortableTable("exp08_t", [
    { k: "pair", t: "쌍" },
    ...M.map(([m, name]) => ({ k: "t_" + m, t: `MMLU · ${name}`, fmt: (v) => fmt(v, 4) })),
    ...M.map(([m, name]) => ({ k: "v_" + m, t: `MMMU · ${name}`, fmt: (v) => fmt(v, 4) })),
  ], mm.rows.map((r, i) => ({ pair: `(${r.pair}, ${r.pair + 1})`, _i: r.pair,
    ...Object.fromEntries(M.map(([m]) => ["t_" + m, r[m]])),
    ...Object.fromEntries(M.map(([m]) => ["v_" + m, (mv.rows.find((x) => x.pair === r.pair) || {})[m]])) })), "_i", true);
}
