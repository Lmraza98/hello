export function buildShellLayoutInput({
  layout,
  startDrag,
  testsLayoutRef,
  detailsInline,
  suitesMinPx,
  casesMinPx,
  detailsMinPx,
  overlayDetailsMaxWidth,
  graphLayoutRef,
  graphCanInlineDetails,
  graphRightWidthClamped,
  startGraphDividerDrag,
  constants,
}) {
  return {
    main: layout,
    mainDividerPx: constants.DIVIDER_PX,
    startDrag,
    overlayDetailsMinPx: constants.OVERLAY_DETAILS_MIN_PX,
    tests: { ref: testsLayoutRef, detailsInline, suitesMinPx, casesMinPx, detailsMinPx, overlayDetailsMaxWidth },
    graph: {
      ref: graphLayoutRef,
      canInlineDetails: graphCanInlineDetails,
      centerMinPx: constants.GRAPH_CENTER_MIN_PX,
      dividerPx: constants.GRAPH_DIVIDER_PX,
      rightMinPx: constants.GRAPH_RIGHT_MIN_PX,
      rightWidthClamped: graphRightWidthClamped,
      startDividerDrag: startGraphDividerDrag,
    },
  };
}

