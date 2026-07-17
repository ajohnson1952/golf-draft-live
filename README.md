# Caveman PGA Draft Game v20

## Fixes

- Stabilized the full-field ticker during refreshes. Existing ticker content remains visible until a complete replacement is ready.
- Prevented unchanged ticker data from rebuilding the ticker DOM every minute.
- Slowed the desktop ticker from 95 seconds to 180 seconds per full pass.
- Replaced the animated ticker on mobile with a swipeable horizontal leaderboard for readability and touch stability.
- Removed the duplicate ticker set on mobile, eliminating blank gaps and touch/hover pause issues.
- Reworked ESPN hole-by-hole parsing to recognize nested `holes`, `holeScores`, `holeByHole`, `scorecard`, `scores`, `linescores`, and `periods` structures.
- Added safer extraction of hole number, strokes, par, and score relative to par.
- Added round-vs-hole detection so 18-hole arrays are not mistaken for four round totals.
- Momentum strips now populate from the normalized completed-hole data used by the traditional scorecards.
- Updated browser cache versions to v20.

## Deployment

Replace all files in the repository and allow Render to redeploy.
