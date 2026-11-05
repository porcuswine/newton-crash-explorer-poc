# Newton Crash Explorer v2

Published at https://porcuswine.github.io/newton-crash-explorer-poc/v2/.

This version adds timeframe comparisons, road and segment analysis, severity
filters, and bicycle/pedestrian involvement filters. Traffic-volume normalization
remains deferred. Data snapshot: November 4, 2026; latest available crash:
October 28, 2026. Recent years are provisional.

The original POC remains at https://porcuswine.github.io/newton-crash-explorer-poc/.

This folder is a self-contained static export of the local map-poc/dist source,
with public version labels. Relative asset paths keep it independent of v1.
When updating v2, replace assets only inside this folder. Preserve every file
outside v2/ to retain the original POC unchanged. GitHub Pages publishes the
main branch root; .nojekyll is retained at that root.

Street selection uses reported roadway names; segments also use approximate
proximity to 2025 MassDOT centerlines. Unlocated crashes are included in matching
citywide and whole-road totals but excluded from segments. Annualized counts
adjust for time only, not traffic exposure.
