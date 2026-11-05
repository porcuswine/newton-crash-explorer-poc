# Newton Crash Explorer v4

Published at https://porcuswine.github.io/newton-crash-explorer-poc/v4/.

V4 adds ward comparisons, official MassDOT traffic-volume layers and clickable
traffic details, and equal-length crash timeframes to the v2 analysis tools.
Choose All Newton or Ward 1–8, then combine dates with road/segment, severity,
and bicycle/pedestrian filters.

Equalize timeframe lengths is checked by default. B controls the inclusive day
count; A’s start is calculated from its editable end. Uncheck to edit both
ranges independently. Reset restores the defaults. B defaults to October 28,
2023–October 28, 2026; A defaults to October 27, 2016–October 28, 2019: exactly
1,097 days each. A’s default ending season follows B before January 1, 2020
until A’s end is manually changed. Unsupported earlier ranges show an error
and retain the last valid comparison.

The crash display covers 2014–2026 YTD: 21,314 records, 20,917 mapped and 397
unlocated. Latest available crash: October 28, 2026. The 2016–2026 snapshot was
downloaded November 4, 2026; verified closed-year 2014/2015 records were added
November 5. Recent years (2024–2026) are provisional. These historical additions
support a 2021–2026 comparison with an equal-length 2014–2019 baseline.

Both timeframes use the same 2022 MassGIS ward polygons. Selected ward totals
require coordinates; unlocated records and points outside all wards remain in
All Newton totals. The UI reports exclusions. Traffic sections intersecting a
ward are shown in full, including portions crossing its boundary.

Traffic uses the official 2023/2024 MassDOT inventory snapshots. AADT is annual
average daily traffic, not live congestion. Modeled volumes are excluded by
default; collection years and source methods appear in the section details.
Snapshot comparisons match route intervals. Traffic-adjusted crash rates remain
unbuilt pending validated annual exposure and road coverage. Annualized crash
counts adjust for time only.

This folder is a self-contained static export of local map-v4/dist, with a
public version label. Source preparation scripts, raw downloads, reconciliation
manifests and tests remain in the local Newton crash-data project. Asset paths
are relative to v4/. GitHub Pages publishes the main branch root; retain the
root .nojekyll file. Update only v4/ to preserve the earlier versions.

Original POC: https://porcuswine.github.io/newton-crash-explorer-poc/.
V2: https://porcuswine.github.io/newton-crash-explorer-poc/v2/.
