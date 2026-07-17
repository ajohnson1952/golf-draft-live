# Caveman PGA Draft Game v24

## Fix

- Fixed the player modal scorecard display after a successful ESPN response.
- v23 fetched and normalized hole-by-hole data correctly, but then called an undefined `mergeRoundDetails()` function in the browser.
- Added `mergeRoundDetails()` to combine leaderboard round summaries with ESPN Core API hole data by round number.
- Detailed hole data now takes priority, while leaderboard totals remain available as fallback values.
- Updated browser asset cache versions to v24.
