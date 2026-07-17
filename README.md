# Caveman PGA Draft Game v23

## Changes

- Switched the primary hole-by-hole request to ESPN Core API competitor linescores.
- Kept ESPN Web API player summary as an automatic fallback.
- Added robust normalization for `items[].period` and `items[].linescores[]`.
- Added server-side diagnostics identifying which endpoint responded and how many rounds/holes were found.
- Improved upstream error details to distinguish HTTP failures from valid responses with no hole data.
- Scorecards are still fetched only when a golfer modal is opened and cached for 30 seconds.
- Updated browser asset cache versions to v23.

## Endpoint order

1. Core API competitor linescores
2. Web API player summary
3. Existing leaderboard round totals in the browser

## Environment

Optional Render environment variables:

- `ESPN_EVENT_ID` (defaults to `401811957`)
- `ESPN_TOUR` (defaults to `pga`)
