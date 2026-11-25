// Exp 11 — 정렬(K 회전 쌍 부호 · V 직교 행렬) 뒤 K·V 공유: KV 공유 정확도로 고른 그리디 곡선과 그 확정 구성의 정렬 뒤 규칙별 정확도
async function render_exp11() {
  const el = document.getElementById("exp11");
  const d = await fetch("data/exp11.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const metric = (b) => (b.task === "mmmu" ? "MMMU" : "MMLU");
  // [키, 이름, 색, 선 모양] — Exp 10 과 같은 규칙 · 같은 표기(전부 정렬 좌표에서 적용)
  const RULES = [
    ["raw", "Baseline · 원래 가중치 균등 평균", PALETTE.muted, "dot"],
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
  const UNI = "(i) 게인 접은 가중치 균등 평균";
  const ALIGN = `<b>K·V 공유</b> = 병합 그룹(같은 입력을 받아 출력을 평균하는 레이어들)이 K·V 를 한 번만 계산해 같이 쓴다(KV 캐시가 그룹당 하나 · Q 는 레이어마다 제 것).
    <b>정렬</b> = 공유 값을 만들기 전에 그룹의 레이어들을 맨 앞 레이어의 좌표에 맞춘다(논문 초안 3.3 절 · KV 헤드마다 따로 · W = 프로젝션에 input_layernorm 게인을 곱해 넣은 가중치).
    K 는 <b>회전 쌍</b>(RoPE 가 함께 돌리는 두 좌표)마다 맨 앞 레이어의 같은 두 행과 내적이 양수가 되게 부호를 정하고 그 헤드를 읽는 Q 에 같은 부호를 곱한다.
    V 는 헤드 블록에 ‖R·V<sub>i</sub> − V<sub>맨 앞</sub>‖ 를 최소로 하는 <b>직교 행렬</b> R 을 곱하고 어텐션 출력을 R 의 전치로 되돌려 읽는다.
    정렬만으로는 어느 레이어의 계산도 바뀌지 않는다 — 바뀌는 것은 그 뒤에 만드는 공유 K·V 뿐이다`;
  const GLOSS = `규칙 = 정렬한 W 들로 공유 K·V 를 만드는 방법(Exp 10 과 같은 정의).
    <b>Baseline</b> = 원래 프로젝션과 게인을 각각 균등 평균 · <b>(i)</b> = W 균등 평균(그리디의 점수) ·
    <b>SVD 병합 A</b> = W 균등 평균에 레이어마다 고유한 특이 방향(보정 데이터 출력 에너지 90% 까지의 오른쪽 특이벡터 중 다른 레이어와 겹치지 않는 성분)의 응답을 되돌린다 ·
    <b>SVD 병합 B</b> = 그 보정에 1 + λ·σ<sub>k</sub>/σ<sub>1</sub> 을 곱한다 ·
    <b>(ii)</b> = 입력 열마다 ‖W 열‖² 비율로 섞는다 · <b>(iii)</b> = 출력 행마다 보정 데이터에서 잰 프로젝션 출력 RMS 비율로 섞는다 ·
    <b>(iv)</b> = (iii) 의 RMS 를 제 헤드 RMS 로 나눈 값의 비율 · <b>(v)</b> = K 는 (iii), V 는 입력 열마다 블록이 잔차 스트림 그 채널을 바꾼 양의 비율 ·
    <b>(vi)</b> = 입력 열마다 LAMP 점수(제 열 노름² ÷ 그 이상인 열들의 노름² 합) 비율 ·
    <b>(vii)</b> = 가중치를 섞지 않고, 레이어마다 뽑은 K·V 를 정렬 좌표에서 헤드별 비율로 섞는다(비율은 보정 데이터에서 원래 어텐션의 로짓 · 읽은 값 오차를 최소로 하게 맞춤)`;
  const count = (b) => b.rounds.reduce((n, r) => n + r.done, 0);
  const ruleCount = (b) => b.rounds.reduce((n, r) => n + (r.none != null) + d.rules.filter((k) => r[k] != null).length, 0);
  el.innerHTML = `
    ${d.bench.map((b) => `
    <div class="panel">
      <h3>${metric(b)} — K·V 공유 정확도로 고른 그리디(순차 깊이 35 → 24)</h3>
      <p class="sub">${esc(b.model)} · ${esc(b.label)} · 로짓 채점 · 가중치 학습 없음.
        <b>KV 공유 그리디</b> = 라운드마다 인접 그룹 쌍 전부(36 − 라운드 개)를 하나씩 합쳐 보고, 그 구성의 그룹 전부를 «정렬 + (i) 균등 평균» 으로 K·V 공유했을 때의 정확도가 가장 높은 것을 확정한다(같으면 앞 위치 · 순차 깊이 = 36 − 라운드).
        <b>병렬 그리디</b>(Exp 06) = 같은 탐색을 K·V 공유 없는 병렬 정확도로 한 것. «공유 없음» = 그 구성을 K·V 공유 없이 병렬로 돌린 값.
        가로 = 순차 깊이. 잡 <code>${b.jobs[0]}</code> · ${count(b)}/354구성.</p>
      <div id="exp11_g_${b.task}" class="chart chart-lg"></div>
    </div>`).join("")}
    ${d.bench.map((b) => `
    <div class="panel">
      <h3>${metric(b)} — 정렬 뒤 K·V 공유 규칙별 정확도(순차 깊이 30 ~ 24)</h3>
      <p class="sub">구성 = KV 공유 그리디 6~12라운드 확정 구성 · 그룹은 규칙과 무관하게 같다. «공유 없음» = 같은 구성을 K·V 공유 없이 병렬로 돌린 값.
        «(i)» 는 그리디가 확정한 값이다. 보정 데이터 = ${esc(b.calibration)}(평가 문항과 겹치지 않음 · 원본 순차 디코더에서 잼).
        가로 = 순차 깊이. 잡 <code>${b.jobs[1]}</code> · ${ruleCount(b)}/89구성.</p>
      <div id="exp11_r_${b.task}" class="chart chart-lg"></div>
    </div>`).join("")}
    <div class="panel">
      <h3>정렬 · 규칙 설명</h3>
      <p class="sub">${ALIGN}.</p>
      <p class="sub">${GLOSS}.</p>
    </div>
    <div class="panel">
      <h3>라운드별 확정 구성</h3>
      <p class="sub">행 = 벤치마크 · 라운드. «이번에 합친 그룹» = 그 라운드에 KV 공유 그리디가 확정한 병합. «병합 그룹» = 레이어 둘 이상인 그룹(나머지 레이어는 혼자 순차로 돈다).
        왼쪽 묶음 = KV 공유 그리디 구성, 오른쪽 묶음 = 병렬 그리디 구성(Exp 06). «정렬 없는 균등 평균» = Exp 10 의 (i)(순차 깊이 30~24 만 있다).</p>
      <div id="exp11_t"></div>
    </div>
    <div class="panel">
      <h3>규칙별 값</h3>
      <p class="sub">위 규칙 차트의 값 전체. 행 = 벤치마크 · 순차 깊이, 열 = 규칙(전부 정렬 뒤 · KV 공유 그리디 구성).</p>
      <div id="exp11_u"></div>
    </div>
    <div class="panel">
      <h3>정렬 통계</h3>
      <p class="sub">순차 깊이 24 확정 구성의 그룹마다, 맨 앞 레이어(기준)에 맞춘 나머지 레이어의 값(KV 헤드 8개 평균).
        «부호가 뒤집힌 회전 쌍» = K 에서 부호 −1 을 받은 회전 쌍의 비율. 코사인 = 그 레이어의 W 와 기준 레이어의 W 를 헤드 블록째 펼친 벡터 사이의 코사인(정렬 전 · 후).
        서로 무관한 무작위 행렬(같은 모양 · 5회 평균)에 같은 정렬을 걸면 뒤집힌 비율 0.49 · K 코사인 0.000 → 0.011 · V 코사인 0.000 → 0.188 이 나온다.
        배선 검사(레이어 30 과 그 좌표만 무작위로 바꾼 사본을 한 그룹으로 공유했을 때 원본 로짓과의 최대 차) —
        ${d.bench.map((b) => `${metric(b)} 정렬 ${b.check ? fmt(b.check.aligned, 2) : "–"} · 정렬 없음 ${b.check ? fmt(b.check.unaligned, 2) : "–"}`).join(" / ")}.</p>
      <details><summary class="sub">표 펼치기</summary><div id="exp11_a"></div></details>
    </div>`;

  const base = { margin: { l: 56, r: 20, t: 8, b: 46 }, legend: { orientation: "h", y: 1.25 } };
  const line = (name, x, y, color, dash, m, width = 1.5) => ({ type: "scatter", mode: "lines+markers", name, x, y, line: { color, width, dash }, marker: { size: 6 },
    connectgaps: false, hovertemplate: "순차 깊이 %{x}<br>" + m + " %{y:.4f}<extra>" + name + "</extra>" });
  const axes = (m) => ({ ...base, xaxis: { title: "순차 깊이", autorange: "reversed", dtick: 1 }, yaxis: { title: m + " 정확도" } });
  d.bench.forEach((b) => {
    const m = metric(b), x = b.rounds.map((r) => r.depth);
    plot(`exp11_g_${b.task}`, [
      line("KV 공유 그리디 구성 · 정렬 + 균등 평균 K·V 공유", x, b.rounds.map((r) => r.uni), PALETTE.acc, "solid", m, 2.5),
      line("KV 공유 그리디 구성 · 공유 없음", x, b.rounds.map((r) => r.none), PALETTE.acc, "dot", m),
      line("병렬 그리디 구성 · 공유 없음(Exp 06)", x, b.rounds.map((r) => r.par), PALETTE.text, "dot", m),
      line("병렬 그리디 구성 · 정렬 없는 균등 평균 K·V 공유(Exp 10)", x, b.rounds.map((r) => r.par_uni), PALETTE.text, "solid", m, 2.5),
    ], axes(m));
    const rs = b.rounds.filter((r) => r.r >= 6), xr = rs.map((r) => r.depth);
    plot(`exp11_r_${b.task}`, [
      line("공유 없음", xr, rs.map((r) => r.none), PALETTE.text, "solid", m, 2.5),
      line(UNI, xr, rs.map((r) => r.uni), PALETTE.muted, "solid", m),
      ...RULES.map(([k, n, color, dash]) => line(n, xr, rs.map((r) => r[k]), color, dash, m)),
    ], axes(m));
  });
  const f4 = (v) => fmt(v, 4), f3 = (v) => fmt(v, 3);
  const rows = d.bench.flatMap((b, bi) => b.rounds.map((r) => ({ ...r, bench: metric(b), _i: bi * 100 + r.r })));
  sortableTable("exp11_t", [
    { k: "bench", t: "벤치마크" }, { k: "r", t: "라운드" }, { k: "depth", t: "순차 깊이" }, { k: "pick", t: "이번에 합친 그룹" },
    { k: "groups", t: "KV 공유 그리디 · 병합 그룹" }, { k: "uni", t: "정렬 + 균등 평균", fmt: f4 }, { k: "none", t: "공유 없음", fmt: f4 },
    { k: "par_groups", t: "병렬 그리디 · 병합 그룹" }, { k: "par", t: "공유 없음", fmt: f4 }, { k: "par_uni", t: "정렬 없는 균등 평균", fmt: f4 },
  ], [...rows], "_i", true);
  sortableTable("exp11_u", [
    { k: "bench", t: "벤치마크" }, { k: "depth", t: "순차 깊이" }, { k: "none", t: "공유 없음", fmt: f4 }, { k: "uni", t: UNI, fmt: f4 },
    ...RULES.map(([k, n]) => ({ k, t: n, fmt: f4 })),
  ], rows.filter((r) => r.r >= 6), "_i", true);
  sortableTable("exp11_a", [
    { k: "bench", t: "벤치마크" }, { k: "group", t: "그룹" }, { k: "layer", t: "레이어" }, { k: "flipped", t: "부호가 뒤집힌 회전 쌍", fmt: f3 },
    { k: "k_cos", t: "K 코사인 · 정렬 전", fmt: f4 }, { k: "k_cos_aligned", t: "K 코사인 · 정렬 후", fmt: f4 },
    { k: "v_cos", t: "V 코사인 · 정렬 전", fmt: f4 }, { k: "v_cos_aligned", t: "V 코사인 · 정렬 후", fmt: f4 },
  ], d.bench.flatMap((b, bi) => b.align.map((s, i) => ({ ...s, bench: metric(b), _i: bi * 1000 + i }))), "_i", true);
}
