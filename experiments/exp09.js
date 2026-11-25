// Exp 09 — 병합 그룹 안 레이어끼리 어텐션 프로젝션(Q · K·V)을 공유했을 때의 정확도(1차 구성별 · 쌍 하나 KV 공유 · 헤드 정렬) 차트와 표
async function render_exp09() {
  const el = document.getElementById("exp09");
  const d = await fetch("data/exp09.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const metric = (b) => (b.task === "mmmu" ? "MMMU" : "MMLU");
  const HOW = [["out", "출력 결합", "solid"], ["fold", "가중치 결합(게인 접기)", "dash"], ["naive", "가중치 결합(단순 평균)", "dot"]];
  const TARGET = [["q", "Q", PALETTE.blue], ["kv", "K·V", PALETTE.acc], ["qkv", "Q·K·V", PALETTE.violet]];
  const GLOSS = `출력 결합(<code>out</code>) = 레이어마다 제 프로젝션으로 값을 뽑은 뒤 그 값을 평균해 그룹 전체가 같이 쓴다(K·V 캐시가 그룹당 하나) ·
    가중치 결합(게인 접기 · <code>fold</code>) = 레이어별 input_layernorm 게인을 프로젝션 가중치에 곱해 넣고 평균한 가중치 하나로 계산 ·
    가중치 결합(단순 평균 · <code>naive</code>) = 프로젝션 가중치와 정규화 게인을 각각 평균`;
  el.innerHTML = `
    ${d.bench.map((b) => `
    <div class="panel">
      <h3>${metric(b)} — 그리디 확정 구성에서 그룹 전체가 프로젝션을 공유할 때</h3>
      <p class="sub">${esc(b.model)} · ${esc(b.label)} · 로짓 채점 · 가중치 학습 없음. 구성 = 같은 세팅 Exp 06 그리디 r라운드 확정 구성(r = 10~15 · 순차 깊이 36 − r).
        병합 그룹(같은 입력을 받아 출력을 평균하는 레이어들) 안에서 Q · K·V · Q·K·V 프로젝션을 공유한다. ${GLOSS} ·
        레이어 전체 평균 = 그룹의 모든 파라미터를 평균한 레이어 하나. «공유 없음» = 같은 구성을 공유 없이 돌린 값(Exp 06).
        가로 = 순차 깊이. 선 색 = 공유 대상 · 선 모양 = 결합 방식. 잡 <code>${b.jobs[0]}</code>.</p>
      <div id="exp09_r_${b.task}" class="chart chart-md"></div>
    </div>`).join("")}
    ${d.bench.map((b) => `
    <div class="panel">
      <h3>${metric(b)} — 인접 쌍 하나만 K·V 를 공유할 때</h3>
      <p class="sub">쌍 (i, i+1) 만 병렬로 묶고 둘이 K·V 를 공유한다(나머지 34층은 원본 · 순차 깊이 35). ${GLOSS}.
        «공유 없음» = 같은 쌍을 공유 없이 병렬로 돌린 값(Exp 06 그리디 1라운드 후보). 가로 = 쌍의 첫 레이어 i. 잡 <code>${b.jobs[1]}</code> · ${b.pairs.length}/35쌍.</p>
      <div id="exp09_p_${b.task}" class="chart chart-md"></div>
    </div>`).join("")}
    <div class="panel">
      <h3>헤드 정렬 후 K·V 공유</h3>
      <p class="sub">1차와 같은 구성(r = 10~15)에서 K·V 만 공유하되, 공유 전에 그룹의 각 레이어 KV 헤드 8개 순서를 그룹 첫 레이어에 맞춘다.
        맞추는 기준 = 보정 데이터(MMLU 는 C4 512토큰 8창 · MMMU 는 dev 객관식 30문항)에서 잰 대응 헤드의 K 코사인 + V 코사인 합이 가장 큰 순서(8! 가지 전부 비교).
        헤드 순서만 바꾸므로 레이어 함수는 그대로다. 잡 <code>t9a</code> · <code>v9a</code>.</p>
      <div id="exp09_al"></div>
    </div>
    <div class="panel">
      <h3>헤드 정렬 — 레이어별 대응 헤드 유사도</h3>
      <p class="sub">그룹 첫 레이어와 그 그룹의 다른 레이어 사이에서, 대응하는 KV 헤드 8쌍의 (K 코사인 + V 코사인) 평균. 최댓값 2(같은 레이어끼리) · 0 이면 무관.
        «정렬 전» = 원래 헤드 순서 · «정렬 후» = 위에서 고른 순서.</p>
      <details><summary class="sub">표 펼치기</summary><div id="exp09_sim"></div></details>
    </div>
    <div class="panel">
      <h3>구성별 값</h3>
      <p class="sub">위 차트의 값 전체. 열 이름 = 결합 방식 · 공유 대상.</p>
      <details><summary class="sub">1차 구성별 표 펼치기</summary><div id="exp09_t_r"></div></details>
      <details><summary class="sub">쌍 하나 K·V 공유 표 펼치기</summary><div id="exp09_t_p"></div></details>
    </div>`;

  const base = { margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.18 } };
  const line = (name, x, y, color, dash, m) => ({ type: "scatter", mode: "lines+markers", name, x, y, line: { color, width: 1.5, dash }, marker: { size: 6 },
    hovertemplate: "%{x}<br>" + m + " %{y:.4f}<extra>" + name + "</extra>" });
  d.bench.forEach((b) => {
    const m = metric(b), x = b.rounds.map((r) => r.depth);
    plot(`exp09_r_${b.task}`, [
      line("공유 없음", x, b.rounds.map((r) => r.none), PALETTE.text, "solid", m),
      ...HOW.flatMap(([h, hn, dash]) => TARGET.map(([t, tn, color]) => line(`${tn} · ${hn}`, x, b.rounds.map((r) => r[`${h}_${t}`]), color, dash, m))),
      line("레이어 전체 평균", x, b.rounds.map((r) => r.layer), PALETTE.acc2, "solid", m),
    ], { ...base, xaxis: { title: "순차 깊이", autorange: "reversed", dtick: 1 }, yaxis: { title: m + " 정확도" } });
    const px = b.pairs.map((r) => r.pair);
    plot(`exp09_p_${b.task}`, [
      line("공유 없음", px, b.pairs.map((r) => r.parallel), PALETTE.text, "solid", m),
      ...HOW.map(([h, hn], i) => line(`K·V · ${hn}`, px, b.pairs.map((r) => r[h]), [PALETTE.acc, PALETTE.blue, PALETTE.violet][i], "solid", m)),
    ], { ...base, xaxis: { title: "쌍의 첫 레이어 i", dtick: 2 }, yaxis: { title: m + " 정확도" } });
  });

  const f4 = (v) => fmt(v, 4), all = d.bench.flatMap((b) => b.rounds.map((r) => ({ ...r, bench: metric(b), _i: (b.task === "mmmu" ? 100 : 0) + r.r })));
  sortableTable("exp09_al", [
    { k: "bench", t: "벤치마크" }, { k: "r", t: "그리디 라운드 r" }, { k: "depth", t: "순차 깊이" }, { k: "none", t: "공유 없음", fmt: f4 },
    ...HOW.flatMap(([h, hn]) => [{ k: `${h}_kv`, t: `${hn} · 정렬 전`, fmt: f4 }, { k: `${h}_kv_al`, t: `${hn} · 정렬 후`, fmt: f4 }]),
  ], all.map((r) => ({ ...r })), "_i", true);
  sortableTable("exp09_sim", [
    { k: "bench", t: "벤치마크" }, { k: "r", t: "그리디 라운드 r" }, { k: "group", t: "그룹" }, { k: "layer", t: "레이어" },
    { k: "identity", t: "정렬 전 유사도", fmt: f4 }, { k: "aligned", t: "정렬 후 유사도", fmt: f4 },
  ], d.bench.flatMap((b, bi) => b.align.map((a, i) => ({ ...a, bench: metric(b), _i: bi * 1000 + i }))), "_i", true);
  sortableTable("exp09_t_r", [
    { k: "bench", t: "벤치마크" }, { k: "r", t: "그리디 라운드 r" }, { k: "depth", t: "순차 깊이" }, { k: "none", t: "공유 없음", fmt: f4 },
    ...HOW.flatMap(([h, hn]) => TARGET.map(([t, tn]) => ({ k: `${h}_${t}`, t: `${hn} · ${tn}`, fmt: f4 }))),
    { k: "layer", t: "레이어 전체 평균", fmt: f4 },
  ], all.map((r) => ({ ...r })), "_i", true);
  const [mm, mv] = d.bench, P = [["parallel", "공유 없음"], ...HOW.map(([h, hn]) => [h, hn])];
  sortableTable("exp09_t_p", [
    { k: "pair", t: "쌍" },
    ...P.map(([k, n]) => ({ k: "t_" + k, t: `MMLU · ${n}`, fmt: f4 })),
    ...P.map(([k, n]) => ({ k: "v_" + k, t: `MMMU · ${n}`, fmt: f4 })),
  ], mm.pairs.map((r) => ({ pair: `(${r.pair}, ${r.pair + 1})`, _i: r.pair,
    ...Object.fromEntries(P.map(([k]) => ["t_" + k, r[k]])),
    ...Object.fromEntries(P.map(([k]) => ["v_" + k, (mv.pairs.find((x) => x.pair === r.pair) || {})[k]])) })), "_i", true);
}
