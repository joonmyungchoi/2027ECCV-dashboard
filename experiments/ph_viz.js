// 자리표시자 — 시각화 섹션. 실제 뷰어를 만들면 이 파일을 통째로 교체한다.
function render_ph_viz() {
  emptyTab("ph_viz", {
    why: "특정 질문의 근거로만 쓰이는 그림은 그 질문 탭에 둔다 — 그림이라서 시각화가 아니다.",
    need: ["볼 대상을 data/ 로 export", "experiments/<id>.js 에 뷰어 작성"],
  });
}
