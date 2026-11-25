// Exp 07 — Qwen 공식 절차로 잰 원본 Qwen3-VL-4B-Instruct 의 MMMU 정확도를 공식 보고치와 나란히 보여 주는 표
async function render_exp07() {
  const el = document.getElementById("exp07");
  const d = await fetch("data/exp07.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
  const s = d.sampling;
  const METHOD = { rule: "규칙 추출(can_infer)", judge: "판정 모델(원본 모델 greedy)", random: "무작위(둘 다 실패)" };
  const batches = Object.entries(d.shard_batches).map(([b, n]) => `배치 ${b} × ${n}조각`).join(" · ");
  el.innerHTML = `
    <div class="panel">
      <h3>MMMU validation 정확도 — 측정값과 공식 보고치</h3>
      <p class="sub">「이 서버 측정」은 큐 잡 <code>${esc(d.job)}</code> 의 산출물(<code>_hub/runs/07_qwen_vl_mmmu_official/origin.json</code>),
        「공식 보고치」는 잡 정의의 <code>reported</code> 값이다.
        절차 <code>${esc(d.protocol)}</code> · temperature ${s.temperature} · top_p ${s.top_p} · top_k ${s.top_k} ·
        presence_penalty ${s.presence_penalty} · 최대 ${s.max_new_tokens.toLocaleString()} 토큰 · seed ${s.seed} ·
        문항 ${d.shards}조각(${batches}) · 조각 합계 ${fmt(d.gpu_hours, 1)} GPU·시간.</p>
      <div class="tbl-wrap"><table id="exp07_t"></table></div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>분야별 정확도</h3>
        <p class="sub">MMMU 6개 분야(discipline)별 맞힌 문항 수와 정확도.</p>
        <div class="tbl-wrap"><table id="exp07_cat"></table></div>
      </div>
      <div class="panel">
        <h3>답 추출 방식별 문항 수</h3>
        <p class="sub">모델 출력에서 답을 뽑은 방식. 규칙 추출이 실패한 문항만 판정 모델로 넘기고, 그것도 실패하면 무작위로 고른다(공식 절차).
          생성이 ${s.max_new_tokens.toLocaleString()} 토큰에서 잘린 문항 ${d.truncated}개.</p>
        <div class="tbl-wrap"><table id="exp07_ext"></table></div>
      </div>
    </div>
    <div class="panel">
      <h3>공식 절차와 다른 점</h3>
      <ul class="sub">${d.deviations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>`;
  sortableTable("exp07_t", [
    { k: "source", t: "출처" },
    { k: "accuracy", t: "정확도", fmt: (v) => fmt(v, 4) },
    { k: "n", t: "문항 수" },
  ], d.overall, "source", true);
  sortableTable("exp07_cat", [
    { k: "category", t: "분야" },
    { k: "correct", t: "맞힘" },
    { k: "n", t: "문항 수" },
    { k: "accuracy", t: "정확도", fmt: (v) => fmt(v, 4) },
  ], d.categories, "accuracy", false);
  sortableTable("exp07_ext", [
    { k: "label", t: "방식" },
    { k: "n", t: "문항 수" },
  ], d.extraction.map((r) => ({ ...r, label: METHOD[r.method] || r.method })), "n", false);
}
