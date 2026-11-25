// Exp 10 — 그리디 확정 구성(순차 깊이 30~24)의 병합 그룹마다 K·V 를 하나로 공유하는 무학습 규칙 12개의 정확도 차트와 표
async function render_exp10() {
  const el = document.getElementById("exp10");
  const d = await fetch("data/exp10.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const metric = (b) => (b.task === "mmmu" ? "MMMU" : "MMLU");
  // [키, 이름, 색, 선 모양]
  const RULES = [
    ["raw", "Baseline · 원래 가중치 균등 평균", PALETTE.muted, "dot"],
    ["uni", "(i) 게인 접은 가중치 균등 평균", PALETTE.muted, "solid"],
    ["svd_a", "SVD 병합 A", PALETTE.acc, "solid"],
    ["svd_b025", "SVD 병합 B · λ 0.25", PALETTE.acc, "dash"],
    ["svd_b050", "SVD 병합 B · λ 0.5", PALETTE.acc, "dashdot"],
    ["svd_b100", "SVD 병합 B · λ 1.0", PALETTE.acc, "dot"],
    ["wnorm", "(ii) 가중치 크기", PALETTE.blue, "solid"],
    ["act", "(iii) 출력 활성 크기", PALETTE.violet, "solid"],
    ["hact", "(iv) 헤드 대비 출력 활성 크기", PALETTE.violet, "dash"],
    ["actupd", "(v) K 활성 크기 · V 채널 갱신량", PALETTE.violet, "dot"],
    ["lamp", "(vi) 상대 열 크기(LAMP)", PALETTE.blue, "dash"],
    ["attn", "(vii) 어텐션 재구성", PALETTE.good, "solid"],
  ];
  const GLOSS = `K·V 공유 = 병합 그룹(같은 입력을 받아 출력을 평균하는 레이어들)이 K·V 를 한 번만 계산해 같이 쓴다(KV 캐시가 그룹당 하나 · Q 는 레이어마다 제 것).
    규칙은 그 공유 K·V 를 만드는 방법이다. W = 레이어의 K·V 프로젝션에 input_layernorm 게인을 곱해 넣은 가중치.
    <b>Baseline</b> = 원래 프로젝션과 게인을 각각 균등 평균 · <b>(i)</b> = W 균등 평균 ·
    <b>SVD 병합 A</b> = W 균등 평균에 레이어마다 고유한 특이 방향(보정 데이터 출력 에너지 90% 까지의 오른쪽 특이벡터 중 다른 레이어와 겹치지 않는 성분)의 응답을 되돌린다 ·
    <b>SVD 병합 B</b> = 그 보정에 1 + λ·σ<sub>k</sub>/σ<sub>1</sub> 을 곱한다 ·
    <b>(ii)</b> = 입력 열마다 ‖W 열‖² 비율로 섞는다 · <b>(iii)</b> = 출력 행마다 보정 데이터에서 잰 프로젝션 출력 RMS 비율로 섞는다 ·
    <b>(iv)</b> = (iii) 의 RMS 를 제 헤드 RMS 로 나눈 값의 비율 · <b>(v)</b> = K 는 (iii), V 는 입력 열마다 블록이 잔차 스트림 그 채널을 바꾼 양의 비율 ·
    <b>(vi)</b> = 입력 열마다 LAMP 점수(제 열 노름² ÷ 그 이상인 열들의 노름² 합) 비율 ·
    <b>(vii)</b> = 가중치를 섞지 않고, 레이어마다 뽑은 K·V 를 헤드별 비율로 섞는다(비율은 보정 데이터에서 원래 어텐션의 로짓 · 읽은 값 오차를 최소로 하게 맞춤)`;
  el.innerHTML = `
    ${d.bench.map((b) => `
    <div class="panel">
      <h3>${metric(b)} — K·V 공유 규칙별 정확도</h3>
      <p class="sub">${esc(b.model)} · ${esc(b.label)} · 로짓 채점 · 가중치 학습 없음. 구성 = 같은 세팅 Exp 06 그리디 r라운드 확정 구성(r = 6~12 · 순차 깊이 36 − r = 30~24) · 그룹은 규칙과 무관하게 같다.
        «공유 없음» = 같은 구성을 K·V 공유 없이 병렬로 돌린 값(Exp 06). 보정 데이터 = ${esc(b.calibration)}(평가 문항과 겹치지 않음 · 원본 순차 디코더에서 잼).
        가로 = 순차 깊이. 잡 <code>${b.job}</code> · ${b.rounds.reduce((n, r) => n + d.rules.filter((k) => r[k] != null).length, 0)}/${d.rules.length * b.rounds.length}구성.</p>
      <div id="exp10_r_${b.task}" class="chart chart-lg"></div>
    </div>`).join("")}
    <div class="panel">
      <h3>규칙 설명</h3>
      <p class="sub">${GLOSS}.</p>
    </div>
    <div class="panel">
      <h3>구성별 값</h3>
      <p class="sub">위 차트의 값 전체. 행 = 벤치마크 · 순차 깊이, 열 = 규칙.</p>
      <div id="exp10_t"></div>
    </div>
    <div class="panel">
      <h3>(vii) 어텐션 재구성이 고른 레이어 비율</h3>
      <p class="sub">순차 깊이 24 구성의 그룹마다, 각 레이어가 공유 K · 공유 V 에서 차지하는 비율(KV 헤드 8개 평균 · 그룹 안 합 1 · 균등이면 1 ÷ 그룹 크기).</p>
      <details><summary class="sub">표 펼치기</summary><div id="exp10_s"></div></details>
    </div>`;

  const base = { margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.25 } };
  const line = (name, x, y, color, dash, m, width = 1.5) => ({ type: "scatter", mode: "lines+markers", name, x, y, line: { color, width, dash }, marker: { size: 6 },
    hovertemplate: "순차 깊이 %{x}<br>" + m + " %{y:.4f}<extra>" + name + "</extra>" });
  d.bench.forEach((b) => {
    const m = metric(b), x = b.rounds.map((r) => r.depth);
    plot(`exp10_r_${b.task}`, [
      line("공유 없음", x, b.rounds.map((r) => r.none), PALETTE.text, "solid", m, 2.5),
      ...RULES.map(([k, n, color, dash]) => line(n, x, b.rounds.map((r) => r[k]), color, dash, m)),
    ], { ...base, xaxis: { title: "순차 깊이", autorange: "reversed", dtick: 1 }, yaxis: { title: m + " 정확도" } });
  });
  const f4 = (v) => fmt(v, 4);
  sortableTable("exp10_t", [
    { k: "bench", t: "벤치마크" }, { k: "depth", t: "순차 깊이" }, { k: "groups", t: "병합 그룹" }, { k: "none", t: "공유 없음", fmt: f4 },
    ...RULES.map(([k, n]) => ({ k, t: n, fmt: f4 })),
  ], d.bench.flatMap((b, bi) => b.rounds.map((r) => ({ ...r, bench: metric(b), _i: bi * 100 + r.r }))), "_i", true);
  sortableTable("exp10_s", [
    { k: "bench", t: "벤치마크" }, { k: "group", t: "그룹" }, { k: "layer", t: "레이어" }, { k: "k", t: "K 비율", fmt: f4 }, { k: "v", t: "V 비율", fmt: f4 },
  ], d.bench.flatMap((b, bi) => b.shares.map((s, i) => ({ ...s, bench: metric(b), _i: bi * 1000 + i }))), "_i", true);
}
