// Exp 01 — 공개 체크포인트의 검증 손실을 이 서버에서 다시 잰 값과 원 기록을 나란히 보여 주는 표
async function render_exp01() {
  const el = document.getElementById("exp01");
  const d = await fetch("data/exp01.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  el.innerHTML = `
    <div class="panel">
      <h3>검증 손실 — 측정값과 원 기록</h3>
      <p class="sub">검증 손실 = 토큰당 교차 엔트로피(nat). 고정 검증셋 ${d.rows[0].sequences.toLocaleString()} 시퀀스 × 4,096 토큰 전부를 채점했다.
        「이 서버 측정」은 큐 잡 <code>${esc(d.job)}</code> 의 산출물(<code>_hub/runs/01_ckpt_val/</code>),
        「체크포인트 동봉 기록」은 각 체크포인트의 <code>release.json</code>, 「논문 표」는 업스트림 <code>docs/final-models.md</code> 값이다.
        측정 환경 — ${esc(d.gpu)} 1장 · ${esc(d.precision)}.</p>
      <div class="tbl-wrap"><table id="exp01_t"></table></div>
    </div>`;
  sortableTable("exp01_t", [
    { k: "model", t: "모델" },
    { k: "loss", t: "이 서버 측정", fmt: (v) => fmt(v, 6) },
    { k: "release_loss", t: "체크포인트 동봉 기록", fmt: (v) => fmt(v, 6) },
    { k: "paper_loss", t: "논문 표", fmt: (v) => fmt(v, 3) },
    { k: "batch", t: "평가 배치 크기" },
    { k: "minutes", t: "소요(분)", fmt: (v) => fmt(v, 1) },
  ], d.rows, "model", true);
}
