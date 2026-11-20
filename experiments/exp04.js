// Exp 04 — Qwen3-4B-Base 의 블록을 학습 없이 두 가지로 재배치한 변형별 NLL·PPL·MMLU 표와 쌍마다 평균 전수 조사 격자
async function render_exp04() {
  const el = document.getElementById("exp04");
  const d = await fetch("data/exp04.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const w = d.datasets.wikitext2, c = d.datasets.c4, s = d.sweep;
  const nllRows = s.rows.filter((r) => r.wikitext2_nll != null);     // 짝수 시작 칸(MMLU 보강분)은 NLL 이 없다
  el.innerHTML = `
    <div class="panel">
      <h3>변형별 다음 토큰 NLL · PPL · MMLU 정확도</h3>
      <p class="sub">${esc(d.model)} 의 디코더 블록 36개를 가중치 변경 없이 실행 순서만 바꿔 채점했다. 레이어 번호는 1부터.
        NLL = 다음 토큰 음의 로그우도(nat/토큰), PPL = exp(NLL). 「∥」 = 같은 입력을 두 가지에 넣고 출력을 (z₁ + z₂) / 2 로 평균.
        「순차 깊이」 = 입력에서 출력까지 차례로 거치는 블록 수.
        WikiText-2 = <code>wikitext-2-raw-v1</code> test 전체(${w.windows}창 · ${w.tokens.toLocaleString()} 토큰),
        C4 = 영어 validation 첫 파일 앞부분(${c.windows}창 · ${c.tokens.toLocaleString()} 토큰). 창 길이 ${d.seqlen.toLocaleString()} 토큰 · ${esc(d.dtype)}.
        MMLU = 4지선다 57과목 test 전체 ${d.mmlu.n.toLocaleString()}문항 · ${d.mmlu.shots}-shot · 정답 보기 글자의 확률이 가장 높으면 맞힘(무작위 기준 0.25).
        큐 잡 <code>${esc(d.job)}</code> · <code>${esc(d.mmlu.job)}</code> 의 산출물(<code>_hub/runs/04_qwen_trainfree_mbt/</code> · <code>…_mmlu/</code>).</p>
      <div class="tbl-wrap"><table id="exp04_t"></table></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>쌍마다 평균 전수 조사 — WikiText-2 NLL</h3>
        <p class="sub">이웃 쌍 (2k−1 ∥ 2k) 을 연속 N쌍 평균하는 모든 경우(N = 1~18 × 시작 위치 = ${nllRows.length}개). 나머지 블록은 원본 순서 그대로.
          가로 = 구간의 첫 레이어, 세로 = 평균한 쌍의 수 N(구간 길이 2N 레이어 · 순차 깊이 36 − N). 원본 NLL ${fmt(s.origin.wikitext2_nll, 4)}.
          색은 4.0 에서 자른다(4.0 이상은 같은 색) — 칸에 올리면 실제 값이 나온다. 잡 <code>qsweep</code>.</p>
        <div id="exp04_hm_nll" class="chart chart-lg"></div>
      </div>
      <div class="panel">
        <h3>쌍마다 평균 전수 조사 — MMLU 정확도(과목마다 앞 20문항)</h3>
        <p class="sub">${s.rows.length}개 변형 — 왼쪽 ${nllRows.length}개에 짝수 레이어에서 시작하는 배치((2∥3), (4∥5), … · ${s.rows.length - nllRows.length}개)를 더해 가로가 1레이어 간격이다. 축의 뜻은 왼쪽과 같다. MMLU 57과목 × 앞 20문항 = ${s.mmlu_n.toLocaleString()}문항 · 5-shot.
          색 범위는 무작위 기준 0.25 ~ 같은 문항에서의 원본 ${fmt(s.origin.mmlu20_acc, 4)}. 잡 <code>qsweepmmlu</code> · <code>qsweepmmlu2</code>.
          ${s.even && s.even.done < s.even.total ? `짝수 시작 칸은 ${s.even.done}/${s.even.total}개 반영(잡이 도는 중 · 빈 칸은 아직 안 잰 칸).` : ""}</p>
        <div id="exp04_hm_mmlu" class="chart chart-lg"></div>
      </div>
    </div>
    <div class="panel">
      <h3>전수 조사 변형별 WikiText-2 NLL 과 MMLU 정확도</h3>
      <p class="sub">점 하나 = 위 NLL 격자의 변형 하나(${nllRows.length}개). 가로 = WikiText-2 NLL(로그 축), 세로 = MMLU 정확도(과목당 20문항), 색 = 평균한 쌍의 수 N.
        ◆ = 원본. 가로 점선 = 4지선다 무작위 기준 0.25. 라운드 4 의 질문(NLL 로 본 순서가 MMLU 에서도 같은가)을 같은 변형 위에서 나란히 본다.</p>
      <div id="exp04_sc" class="chart chart-md"></div>
    </div>
    <div class="panel">
      <h3>쌍마다 평균 전수 조사 — 변형별 값</h3>
      <p class="sub">위 두 격자의 값 전체(짝수 시작 칸은 NLL 을 재지 않아 «—»). 변형 이름 <code>lw_a_b</code> = 레이어 a~b 를 쌍마다 평균. 이미 이름이 있던 배치(<code>early_layerwise</code> 등)는 그 이름을 쓴다.
        맨 아래 고정 행이 원본(MMLU 는 같은 ${s.mmlu_n.toLocaleString()}문항 기준).</p>
      <div id="exp04_sweep_t"></div>
    </div>`;
  sortableTable("exp04_t", [
    { k: "variant", t: "변형" },
    { k: "placement", t: "블록 배치" },
    { k: "depth", t: "순차 깊이" },
    { k: "wikitext2_nll", t: "WikiText-2 NLL", fmt: (v) => fmt(v, 4) },
    { k: "wikitext2_ppl", t: "WikiText-2 PPL", fmt: (v) => fmt(v, 2) },
    { k: "c4_nll", t: "C4 NLL", fmt: (v) => fmt(v, 4) },
    { k: "c4_ppl", t: "C4 PPL", fmt: (v) => fmt(v, 2) },
    { k: "mmlu_acc", t: "MMLU 정확도", fmt: (v) => fmt(v, 4) },
  ], d.rows, "wikitext2_nll", true);

  // 격자 — 가로 = 구간의 첫 레이어 · 세로 N(쌍 수). 끝 레이어가 36 을 넘는 칸은 비운다.
  //   NLL 은 홀수 시작만(2칸 간격), MMLU 는 짝수 시작까지(1칸 간격 · 2026-11-20 보강).
  const ys = [...Array(18)].map((_, i) => i + 1);
  const odd = [...Array(18)].map((_, i) => 2 * i + 1), every = [...Array(35)].map((_, i) => i + 1);
  const grid = (key, xs) => {
    const z = ys.map(() => xs.map(() => null)), names = ys.map(() => xs.map(() => ""));
    for (const r of s.rows) {
      const col = xs.indexOf(r.first);
      if (r[key] == null || col < 0) continue;
      z[r.pairs - 1][col] = r[key]; names[r.pairs - 1][col] = `${r.variant} · 레이어 ${r.first}~${r.last}`;
    }
    return { z, names };
  };
  const hm = (id, key, opts) => {
    const xs = opts.xs, g = grid(key, xs);
    plot(id, [{
      type: "heatmap", x: xs, y: ys, z: g.z, customdata: g.names, colorscale: "Magma",
      xgap: 1, ygap: 1,
      reversescale: !!opts.reverse, zmin: opts.zmin, zmax: opts.zmax, hoverongaps: false,
      colorbar: { title: { text: opts.cbar, side: "right" }, thickness: 12, len: .9 },
      hovertemplate: `%{customdata}<br>N=%{y}쌍<br>${opts.cbar} %{z:.4f}<extra></extra>`,
    }], {
      margin: { l: 52, r: 20, t: 8, b: 46 },
      xaxis: { title: "구간의 첫 레이어", tickvals: odd, gridcolor: "rgba(0,0,0,0)" },
      yaxis: { title: "평균한 쌍의 수 N", tickvals: ys, autorange: "reversed", gridcolor: "rgba(0,0,0,0)" },
    });
  };
  hm("exp04_hm_nll", "wikitext2_nll", { cbar: "WikiText-2 NLL", zmin: s.origin.wikitext2_nll, zmax: 4.0, reverse: true, xs: odd });
  hm("exp04_hm_mmlu", "mmlu20_acc", { cbar: "MMLU 정확도", zmin: 0.25, zmax: s.origin.mmlu20_acc, xs: every });

  // 산점도 — 변형마다 (NLL, MMLU). 밝을수록 N 이 크다(구간이 길다).
  plot("exp04_sc", [
    { type: "scatter", mode: "markers", name: "쌍마다 평균",
      x: nllRows.map((r) => r.wikitext2_nll), y: nllRows.map((r) => r.mmlu20_acc),
      customdata: nllRows.map((r) => `${r.variant} · 레이어 ${r.first}~${r.last} · N=${r.pairs}`),
      marker: { size: 8, color: nllRows.map((r) => r.pairs), colorscale: "Magma", cmin: 1, cmax: 18,
        line: { width: 0.5, color: PALETTE.bg },
        colorbar: { title: { text: "쌍의 수 N", side: "right" }, thickness: 12, len: .9 } },
      hovertemplate: "%{customdata}<br>WikiText-2 NLL %{x:.4f}<br>MMLU %{y:.4f}<extra></extra>" },
    { type: "scatter", mode: "markers", name: "원본",
      x: [s.origin.wikitext2_nll], y: [s.origin.mmlu20_acc],
      marker: { size: 14, symbol: "diamond", color: PALETTE.text, line: { width: 1.5, color: PALETTE.bg } },
      hovertemplate: "원본<br>WikiText-2 NLL %{x:.4f}<br>MMLU %{y:.4f}<extra></extra>" },
  ], {
    showlegend: false,
    margin: { l: 56, r: 20, t: 8, b: 48 },
    xaxis: { title: "WikiText-2 NLL (로그 축)", type: "log" },
    yaxis: { title: "MMLU 정확도 (과목당 20문항)", range: [0.15, 0.85] },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0.25, y1: 0.25,
      line: { color: PALETTE.faint, width: 1, dash: "dot" } }],
  });

  sortableTable("exp04_sweep_t", [
    { k: "variant", t: "변형" },
    { k: "first", t: "첫 레이어" },
    { k: "last", t: "끝 레이어" },
    { k: "pairs", t: "쌍 수 N" },
    { k: "depth", t: "순차 깊이" },
    { k: "wikitext2_nll", t: "WikiText-2 NLL", fmt: (v) => fmt(v, 4) },
    { k: "c4_nll", t: "C4 NLL", fmt: (v) => fmt(v, 4) },
    { k: "mmlu20_acc", t: "MMLU 정확도(과목당 20)", fmt: (v) => fmt(v, 4) },
  ], s.rows, "wikitext2_nll", true,
  { variant: "origin(원본)", first: "–", last: "–", pairs: 0, depth: 36,
    wikitext2_nll: s.origin.wikitext2_nll, c4_nll: s.origin.c4_nll, mmlu20_acc: s.origin.mmlu20_acc });
}
