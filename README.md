# Caveman PGA Draft Game v22

## Changes

- Added an on-demand server proxy for ESPN's golf player-summary endpoint.
- Golfer modals now fetch per-round, per-hole scores using the golfer's ESPN athlete ID.
- Hole scores render with traditional golf notation: double circle for eagle or better, circle for birdie, plain for par, square for bogey, and double square for double bogey or worse.
- Added a short loading state while the detailed scorecard is fetched.
- Player scorecards are cached in the browser and for 30 seconds on the server.
- Existing leaderboard round totals remain as a fallback when ESPN's detailed endpoint is unavailable.
- Updated asset cache versions to v22.

## Environment

Optional Render environment variables:

- `ESPN_EVENT_ID` (defaults to `401811957`)
- `ESPN_TOUR` (defaults to `pga`)
