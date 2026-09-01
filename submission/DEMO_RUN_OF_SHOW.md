# ExactCue demo run-of-show

**Target:** 2:40 · **hard cap:** under 3:00 · English · real deployed app

**Event:** The WebMCP Challenge

**Kill shot:** a reviewed v1 becomes stale; ExactCue shows `FAIL-CLOSED · NO WRITE MADE`, loads v2, requires a new read-back, and preserves the authoritative receipt.

**Capture:** `pnpm capture:demo` records the real public app and real Netlify Blobs conflict-to-recovery path to `.artifacts/demo/exactcue-proof.mp4`. The fresh-state walkthrough is captured separately so navigation cannot corrupt either recording. Never substitute a mock screen.

| Time | Beat | On screen | Voiceover | Rubric |
|---|---|---|---|---|
| 0:00–0:09 | Kill-shot cold open | Start on the real red conflict panel: `Your review v1 → Current record v2`; hold on `NO WRITE MADE` | “Marcus heard one refill. Before he confirmed, the record changed. ExactCue refuses the stale action. Nothing is submitted.” | Impact · Creativity |
| 0:09–0:20 | Name + thesis | Recover to authoritative receipt; ExactCue masthead and tagline remain visible | “ExactCue gives browser agents current-state-bound actions: the exact action, then the user’s cue.” | Creativity |
| 0:20–0:36 | Honest problem | Start fresh; show synthetic label, prescription step, and live tools | “A screen-reading or computer-use agent can operate a form. But a non-sighted user cannot visually catch a guessed control—or a record that changed after it was read.” | Impact |
| 0:36–0:58 | WebMCP is load-bearing | Agent selects two prescriptions; tool surface changes as the app advances | “The page publishes typed WebMCP actions from the user’s authenticated session. Tool authority follows state: prescription actions retire, then pickup actions retire.” | WebMCP Leverage |
| 0:58–1:14 | Real blocker | Briefly show Metformin’s prescriber-authorization state, then chosen pickup | “The agent gets the same eligibility rules as the visible UI. An ineligible refill stays blocked; there is no clinical advice here.” | Execution · Impact |
| 1:14–1:34 | Exact read-back | Review screen, version, ETag, summary, and five-tool surface; `go_to_next_step` is absent | “At review, navigation disappears. `review_order` binds this exact prescription set, pharmacy, version, and ETag. `submit_refill` requires explicit confirmation.” | WebMCP Leverage |
| 1:34–1:54 | Failure under concurrency | Competing write lands; stale submit changes the live page to red conflict | “Now another session commits first. The Netlify Function checks both version and Blob ETag. The stale agent receives HTTP 409. No write.” | WebMCP Leverage · Creativity |
| 1:54–2:13 | Recovery | Click Load current record; show v2 confirmation and receipt | “Recovery is part of the contract. ExactCue loads the authoritative record, retires stale authority, and requires a fresh read-back before any new action.” | Execution |
| 2:13–2:28 | Proof receipts | Hold on request/storage/version/tool surfaces; optionally cut to public repo tests | “This is the deployed path: native `document.modelContext`, Netlify Functions and Blobs, conditional writes, replay rejection, isolated demo sessions, and zero automated A/AA violations across every hero state.” | Execution · WebMCP Leverage |
| 2:28–2:40 | Close | ExactCue wordmark, live URL, public repo, MIT | “The pharmacy is the proof case. ExactCue is the reusable pattern: current-state-bound actions for browser agents.” | All |

## Recording notes

- Capture at 1600×900/30 fps; export H.264 MP4, English narration, no copyrighted music.
- Keep the real conflict panel in the first frame. Do not open with a logo animation.
- Record the fresh WebMCP walkthrough as a second take; use the deterministic capture command for the kill shot and recovery insert.
- Narration target: about 360–390 words, 145–155 wpm.
- Show the public repository only after anonymous access is verified.
- Final compliance: `<3:00`, actual working app, YouTube public, “Not made for kids,” non-empty description.
