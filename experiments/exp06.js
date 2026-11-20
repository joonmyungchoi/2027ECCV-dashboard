// Exp 06 — Qwen3-4B-Base 레이어 병합(인접 쌍 그리디 · 3개 병합 · 4층 블록 병합)의 구성별 MMLU 정확도 차트와 표
async function render_exp06() {
  const el = document.getElementById("exp06");
  const d = await fetch("data/exp06.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const o = d.origin.mmlu_acc, greedy = d.rows.filter((r) => r.kind === "greedy");
  const prog = (jobs) => jobs.map((j) => `<code>${j}</code> ${d.done[j]}/${d.totals[j]}`).join(" · ");
  const conf = Object.entries(d.confirmed).map(([r, gs]) => `${r}라운드 확정 = ${gs.map((g) => `[${g.join(",")}]`).join(" ")}`).join(" · ");
  el.innerHTML = `
    <div class="panel">
      <h3>인접 쌍 그리디 병합 — 라운드별 후보 MMLU 정확도</h3>
      <p class="sub">${esc(d.model)} · 가중치 변경 없음. 그룹 = 같은 입력을 받아 출력을 균등 평균하는 원본 레이어들(레이어 번호는 1부터).
        라운드 r 마다 기준 구성의 인접 그룹 쌍을 하나씩 합친 후보 전부(35 · 34 · 33개)를 재고, 정확도가 가장 높은 후보를 다음 라운드의 기준으로 확정한다(순차 깊이 36 − r).
        가로 = 그 라운드에서 새로 합친 그룹의 첫 레이어. 점선 = 원본 ${fmt(o, 4)}. MMLU test 전체 ${d.origin.n.toLocaleString()}문항 · 5-shot.
        ${conf ? conf + "." : ""} 진행 ${prog(["mg1", "mg2", "mg3"])}.</p>
      <div id="exp06_greedy" class="chart chart-md"></div>
    </div>
    <div class="panel">
      <h3>3개 병합 · 4층 블록 병합 — 위치별 MMLU 정확도</h3>
      <p class="sub">한 구성에 병합을 하나만 넣는다. 4의 배수 레이어(4 · 8 · … · 36)를 GSA 자리로 둔다(Qwen3 는 전 레이어가 full attention).
        3개 병합 = [a, a+1, a+2] 세 레이어를 한 그룹으로(a = 1, 5, …, 33 · 순차 깊이 34).
        4층 블록 병합 = [a→a+1→a+2→a+3 ∥ a+4→…→a+7] 4층 가지 둘을 한 단계로(a = 1, 5, …, 29 · 순차 깊이 32).
        가로 = 병합의 첫 레이어. 점선 = 원본 ${fmt(o, 4)}. 진행 ${prog(["mtri", "mblk"])}.</p>
      <div id="exp06_fixed" class="chart chart-md"></div>
    </div>
    <div class="panel">
      <h3>구성별 값</h3>
      <p class="sub">위 두 차트의 값 전체. «병합» 열 = 구성 안에서 원본과 다른 단계(∥ = 같은 입력을 받아 평균 · → = 순차). 맨 아래 고정 행이 원본(Exp 04 <code>qmmlu</code>).</p>
      <div id="exp06_t"></div>
    </div>`;

  const ref = [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: o, y1: o, line: { color: PALETTE.faint, width: 1, dash: "dot" } }];
  const colors = [PALETTE.acc, PALETTE.blue, PALETTE.violet];
  plot("exp06_greedy", [1, 2, 3].map((round, i) => {
    const rs = greedy.filter((r) => r.round === round);
    return { type: "scatter", mode: "lines+markers", name: `${round}라운드`, x: rs.map((r) => r.first), y: rs.map((r) => r.mmlu_acc),
      customdata: rs.map((r) => `${r.variant} · 새 그룹 ${r.new}`), line: { color: colors[i], width: 1.5 }, marker: { size: 6 },
      hovertemplate: "%{customdata}<br>MMLU %{y:.4f}<extra>%{fullData.name}</extra>" };
  }), {
    margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.08 },
    xaxis: { title: "새로 합친 그룹의 첫 레이어", dtick: 2 }, yaxis: { title: "MMLU 정확도", range: [0.2, 0.76] }, shapes: ref,
  });

  const fixed = [["tri", "3개 병합", PALETTE.acc2], ["blk", "4층 블록 병합", PALETTE.violet]].map(([kind, name, color]) => {
    const rs = d.rows.filter((r) => r.kind === kind);
    return { type: "scatter", mode: "lines+markers", name, x: rs.map((r) => r.first), y: rs.map((r) => r.mmlu_acc),
      customdata: rs.map((r) => `${r.variant} · ${r.merged} · 순차 깊이 ${r.depth}`), line: { color, width: 1.5 }, marker: { size: 8 },
      hovertemplate: "%{customdata}<br>MMLU %{y:.4f}<extra></extra>" };
  });
  plot("exp06_fixed", fixed, {
    margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.08 },
    xaxis: { title: "병합의 첫 레이어", tickvals: [1, 5, 9, 13, 17, 21, 25, 29, 33] },
    yaxis: { title: "MMLU 정확도", range: [0.2, 0.76] }, shapes: ref,
  });

  sortableTable("exp06_t", [
    { k: "variant", t: "구성" },
    { k: "job", t: "잡" },
    { k: "merged", t: "병합" },
    { k: "depth", t: "순차 깊이" },
    { k: "mmlu_acc", t: "MMLU 정확도(문항 평균)", fmt: (v) => fmt(v, 4) },
    { k: "mmlu_macro", t: "MMLU 정확도(과목 평균)", fmt: (v) => fmt(v, 4) },
  ], d.rows, "mmlu_acc", false,
  { variant: "origin(원본)", job: "qmmlu", merged: "–", depth: 36, mmlu_acc: o, mmlu_macro: null });
}
