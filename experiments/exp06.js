// Exp 06 — 레이어 병합(인접 쌍 그리디 · 3개 병합 · 4층 블록 병합 · 정렬 누적)의 구성별 정확도를 세팅(MMLU 전체 · MMLU 1,140 · MMMU 847)별로 보여 주는 차트와 표
async function render_exp06() {
  const el = document.getElementById("exp06");
  const d = await fetch("data/exp06.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  el.innerHTML = `
    <div class="chip-bar" id="exp06_set">${d.settings.map((s, i) =>
      `<button class="chip${i === 1 ? " on act" : ""}" data-set="${s.id}">${esc(s.label)}</button>`).join("")}</div>
    <div id="exp06_body"></div>`;
  const bar = el.querySelector("#exp06_set");
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-set]");
    if (!b) return;
    bar.querySelectorAll(".chip").forEach((c) => { c.classList.toggle("on", c === b); c.classList.toggle("act", c === b); });
    draw(d.settings.find((s) => s.id === b.dataset.set));
  });
  draw(d.settings[1]);

  function draw(s) {
    const o = s.origin.acc, metric = s.task === "mmmu" ? "MMMU" : "MMLU";
    const greedy = s.rows.filter((r) => r.kind === "greedy").sort((a, b) => a.round - b.round || a.position - b.position), sort = s.rows.filter((r) => r.kind === "sort").sort((a, b) => a.k - b.k);
    const prog = Object.keys(s.totals).map((j) => `<code>${j}</code> ${s.done[j]}/${s.totals[j]}`).join(" · ");
    const conf = Object.entries(s.confirmed).map(([r, c]) => ({ round: +r, ...c, groups: c.groups.map((g) => `[${g.join(",")}]`).join(" ") }));
    const lines = `점선 = 원본 ${fmt(o, 4)} · 파선 = 판정선(원본 − 2SE) ${fmt(s.threshold, 4)}`;
    el.querySelector("#exp06_body").innerHTML = `
      <div class="panel">
        <h3>그리디 — 라운드마다 확정한 구성의 ${metric} 정확도</h3>
        <p class="sub">${esc(s.model)} · ${esc(s.label)} · 가중치 변경 없음. 그룹 = 같은 입력을 받아 출력을 균등 평균하는 원본 레이어들(레이어 번호는 1부터).
          라운드 r 마다 기준 구성의 인접 그룹 쌍을 하나씩 합친 후보 전부(36 − r 개)를 재고, 정확도가 가장 높은 후보(같으면 앞 위치)를 다음 라운드의 기준으로 확정한다.
          가로 = 순차 깊이(36 − r). ${lines}. 진행 ${prog}.${s.fit ? ` «MMLU test 전체» = 이 세팅(1,140문항)으로 고른 같은 확정 구성을 MMLU test 전체 14,042문항으로 다시 잰 값(잡 <code>tfit</code> · <code>tfit2</code> · 전체 문항에서 원본은 ${fmt(s.fit.origin, 4)}).` : ""}</p>
        <div id="exp06_path" class="chart chart-md"></div>
        <div class="tbl-wrap"><table id="exp06_conf"></table></div>
      </div>
      <div class="panel">
        <h3>그리디 — 라운드별 후보 ${metric} 정확도</h3>
        <p class="sub">라운드마다 후보 전부(선 하나 = 라운드 하나 · 앞 위치에서 뒤 위치 순으로 잇는다 · 11라운드부터는 같은 색의 파선). 가로 = 그 라운드에서 새로 합친 그룹의 첫 레이어. ${lines}.</p>
        <div id="exp06_greedy" class="chart chart-md"></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <h3>정렬 누적 병합 — k 별 ${metric} 정확도</h3>
          <p class="sub">그리디 1라운드 35쌍을 정확도 순으로 정렬해 위에서 k 개를 한꺼번에 합친다(겹치는 쌍은 한 그룹으로 · 순차 깊이 36 − k).
            ${s.id === "full" ? "k = 2·3 은 그리디 2·3라운드 확정 구성과 같아 이 세팅에서는 안 돌렸다. " : ""}가로 = k. ${lines}.</p>
          <div id="exp06_sort" class="chart chart-md"></div>
        </div>
        <div class="panel">
          <h3>3개 병합 · 4층 블록 병합 — 위치별 ${metric} 정확도</h3>
          <p class="sub">한 구성에 병합을 하나만 넣는다. 3개 병합 = [a, a+1, a+2] 한 그룹(a = 1, 5, …, 33 · 순차 깊이 34).
            4층 블록 병합 = [a→…→a+3 ∥ a+4→…→a+7] 4층 가지 둘을 한 단계로(a = 1, 5, …, 29 · 순차 깊이 32). 가로 = 병합의 첫 레이어. ${lines}.</p>
          <div id="exp06_fixed" class="chart chart-md"></div>
        </div>
      </div>
      <div class="panel">
        <h3>구성별 값</h3>
        <p class="sub">위 차트의 값 전체(${s.rows.length}구성). «병합» 열 = 구성 안에서 원본과 다른 단계(∥ = 같은 입력을 받아 평균 · → = 순차). 맨 아래 고정 행이 원본(잡 <code>${s.origin.job}</code>).</p>
        <details><summary class="sub">표 펼치기</summary><div id="exp06_t"></div></details>
      </div>`;

    const ref = [
      { type: "line", xref: "paper", x0: 0, x1: 1, y0: o, y1: o, line: { color: PALETTE.faint, width: 1, dash: "dot" } },
      { type: "line", xref: "paper", x0: 0, x1: 1, y0: s.threshold, y1: s.threshold, line: { color: PALETTE.acc2, width: 1, dash: "dash" } },
    ];
    const yr = s.task === "mmmu" ? [0.2, 0.58] : [0.2, 0.8];
    const base = { margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.1 }, shapes: ref };

    plot("exp06_path", [{
      type: "scatter", mode: "lines+markers", name: "확정 구성", x: [36, ...conf.map((c) => c.depth)], y: [o, ...conf.map((c) => c.acc)],
      customdata: ["원본", ...conf.map((c) => `${c.round}라운드 · ${c.groups}`)], line: { color: PALETTE.acc, width: 2 }, marker: { size: 8 },
      hovertemplate: "%{customdata}<br>순차 깊이 %{x}<br>" + metric + " %{y:.4f}<extra></extra>",
    }, ...(s.fit ? [{
      type: "scatter", mode: "lines+markers", name: "같은 구성 · MMLU test 전체 14,042", x: [36, ...conf.map((c) => c.depth)], y: [s.fit.origin, ...conf.map((c) => c.full)],
      customdata: ["원본", ...conf.map((c) => `${c.round}라운드`)], line: { color: PALETTE.blue, width: 2, dash: "dot" }, marker: { size: 6 },
      hovertemplate: "%{customdata}<br>순차 깊이 %{x}<br>MMLU test 전체 %{y:.4f}<extra></extra>",
    }] : [])], { ...base, xaxis: { title: "순차 깊이", autorange: "reversed", dtick: 1 },
      yaxis: { title: metric + " 정확도", range: [Math.min(s.threshold, ...conf.flatMap((c) => [c.acc, c.full ?? c.acc])) - 0.01, Math.max(o, ...conf.map((c) => c.acc)) + 0.01] } });
    sortableTable("exp06_conf", [
      { k: "round", t: "라운드" },
      { k: "depth", t: "순차 깊이" },
      { k: "groups", t: "확정 구성의 병합 그룹" },
      { k: "acc", t: metric + " 정확도", fmt: (v) => fmt(v, 4) },
      ...(s.fit ? [{ k: "full", t: "같은 구성 · MMLU test 전체 14,042", fmt: (v) => fmt(v, 4) }] : []),
    ], conf, "round", true);

    const rounds = [...new Set(greedy.map((r) => r.round))].sort((a, b) => a - b);
    const colors = [PALETTE.acc, PALETTE.blue, PALETTE.violet, PALETTE.good, PALETTE.acc2, "#d4a5e8", "#8fd3f4", "#f5d76e", "#c0c0c8", "#e89a6f"];
    plot("exp06_greedy", rounds.map((round, i) => {
      const rs = greedy.filter((r) => r.round === round);
      return { type: "scatter", mode: "lines+markers", name: `${round}라운드`, x: rs.map((r) => r.first), y: rs.map((r) => r.acc),
        customdata: rs.map((r) => `${r.variant} · 새 그룹 ${r.new}`), line: { color: colors[(round - 1) % colors.length], width: 1.5, dash: round > 10 ? "dash" : "solid" }, marker: { size: 5 },
        hovertemplate: "%{customdata}<br>" + metric + " %{y:.4f}<extra>%{fullData.name}</extra>" };
    }), { ...base, xaxis: { title: "새로 합친 그룹의 첫 레이어", dtick: 2 }, yaxis: { title: metric + " 정확도", range: yr } });

    plot("exp06_sort", [{
      type: "scatter", mode: "lines+markers", name: "정렬 누적", x: sort.map((r) => r.k), y: sort.map((r) => r.acc),
      customdata: sort.map((r) => `${r.variant} · 순차 깊이 ${r.depth} · ${r.merged}`), line: { color: PALETTE.blue, width: 1.5 }, marker: { size: 7 },
      hovertemplate: "%{customdata}<br>" + metric + " %{y:.4f}<extra></extra>",
    }], { ...base, xaxis: { title: "k (합친 쌍 수)", dtick: 2 }, yaxis: { title: metric + " 정확도", range: yr } });

    plot("exp06_fixed", [["tri", "3개 병합", PALETTE.acc2], ["blk", "4층 블록 병합", PALETTE.violet]].map(([kind, name, color]) => {
      const rs = s.rows.filter((r) => r.kind === kind).sort((a, b) => a.first - b.first);
      return { type: "scatter", mode: "lines+markers", name, x: rs.map((r) => r.first), y: rs.map((r) => r.acc),
        customdata: rs.map((r) => `${r.variant} · ${r.merged} · 순차 깊이 ${r.depth}`), line: { color, width: 1.5 }, marker: { size: 8 },
        hovertemplate: "%{customdata}<br>" + metric + " %{y:.4f}<extra></extra>" };
    }), { ...base, xaxis: { title: "병합의 첫 레이어", tickvals: [1, 5, 9, 13, 17, 21, 25, 29, 33] }, yaxis: { title: metric + " 정확도", range: yr } });

    sortableTable("exp06_t", [
      { k: "variant", t: "구성" },
      { k: "job", t: "잡" },
      { k: "merged", t: "병합" },
      { k: "depth", t: "순차 깊이" },
      { k: "acc", t: metric + " 정확도(문항 평균)", fmt: (v) => fmt(v, 4) },
      { k: "macro", t: metric + " 정확도(과목 평균)", fmt: (v) => fmt(v, 4) },
    ], [...s.rows], "acc", false,      // 사본을 넘긴다 — sortableTable 이 배열을 제자리에서 정렬해, 원본을 넘기면 다시 그릴 때 차트 선이 정확도 순으로 이어진다
    { variant: "origin(원본)", job: s.origin.job, merged: "–", depth: 36, acc: o, macro: null });
  }
}
