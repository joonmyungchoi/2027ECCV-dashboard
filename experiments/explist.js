// 분석 > 실험 목록 — Exp 별로 어떤 세부 실험이 있는지(무엇을 바꾸나 · 모델 · 평가 · 구성 수 · 상태)를 한 표로 보여 주는 탭
async function render_explist() {
  const el = document.getElementById("explist");
  const d = await fetch("data/explist.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  el.innerHTML = `
    <style>
      #explist_t th, #explist_t td { text-align: left; white-space: normal; vertical-align: top; font-family: inherit; line-height: 1.5; }
      #explist_t td:first-child { white-space: nowrap; }
      #explist_t a { color: ${PALETTE.acc}; text-decoration: none; font-weight: 600; }
      #explist_t a:hover { text-decoration: underline; }
    </style>
    <div class="panel">
      <h3>실험 목록</h3>
      <p class="sub">한 행 = 세부 실험 하나. «구성 수» = 그 세부 실험에서 벤치마크 하나당 평가한 모델 구성의 수. Exp 번호를 누르면 그 실험 탭으로 간다(탭이 없는 실험은 아직 돌리지 않은 것).
        목록의 원본은 <code>data/explist.json</code>(손으로 관리).</p>
      <div id="explist_t"></div>
    </div>`;
  sortableTable("explist_t", [
    { k: "exp", t: "Exp", fmt: (v, r) => (r.tab ? `<a href="#${r.tab}">Exp ${v}</a>` : `Exp ${v}`) },
    { k: "sub", t: "세부 실험", cls: "txt" },
    { k: "what", t: "무엇을 하나", cls: "txt" },
    { k: "model", t: "모델", cls: "txt" },
    { k: "bench", t: "평가", cls: "txt" },
    { k: "n", t: "구성 수", cls: "txt" },
    { k: "status", t: "상태", cls: "txt" },
  ], d.rows.map((r, i) => ({ ...r, _i: i })), "_i", true);
}
