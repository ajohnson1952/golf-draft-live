# Caveman PGA Draft Game v14

## Change notes

- Team cards remain still during ordinary score refreshes.
- A card animates only when that team’s actual competition rank changes.
- Tied teams retain their existing display order instead of swapping alphabetically on refresh.
- Genuine rank movement uses a shorter, subtler 320 ms transition.
- Green/red score flashes still occur only for real moves up or down.
- Updated browser cache version to v14.

All v13 functionality remains included: live ESPN scoring, best-three totals, prior-round movement, Groups to Watch, recent highlights, team/golfer details, payouts, and the navy/white theme.


## v15 changes
- Tee times are converted to America/Chicago and labeled CT/CDT as appropriate.
- Scheduled golfers no longer appear as finished before starting their round.
- Current-round scoring is suppressed until the golfer has actually started.

## v16 fix

- A future Central-time tee time or ESPN pre-round state now overrides stale `F`/18-hole values left over from the prior round.
- Players waiting to tee off show their tee time (or `Not started`) instead of `Finished round`.
- Added an explicit current-round `started` flag from the server and made the UI prioritize it.
