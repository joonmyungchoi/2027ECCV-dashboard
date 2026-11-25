// 자리표시자 — 파이프라인 섹션. 모델 구조·자원 분석을 만들면 이 파일을 통째로 교체한다.
function render_ph_pipe() {
  emptyTab("ph_pipe", {
    why: "실험 결과가 아니라 구조를 보는 자리다. 분석할 모델이 아직 정해지지 않았다.",
    need: ["분석 대상 모델 확정", "scripts/profile_pipeline.py 로 data/<model>_pipe/ 생성", "experiments/pipeline-model.example.js 를 복사해 채움"],
  });
}
