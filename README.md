# ExactCue

**Current-state-bound actions for browser agents. The exact action. Your cue.**

ExactCue is a WebMCP reference implementation for a consequential browser-agent boundary: the
page exposes the actions valid _right now_, binds read-back to the exact current proposal, and
commits only while the authoritative record still matches. A synthetic prescription refill is the
proof case, not the product category.

> Meet Marcus, the synthetic demo user. He's blind. Today, refilling his prescriptions means
> fighting a form built for a mouse. With ExactCue he says, _"refill my cholesterol and blood-pressure meds for pickup at
> Marmora"_ — hears exactly what's about to happen — and confirms.

## Why WebMCP — the honest version

We are **not** claiming a general browser agent _can't_ operate a web page. Computer-use agents
(ChatGPT's browser, Comet, Copilot in Edge) already drive authenticated sessions through the
accessibility tree or raw pixels. So why WebMCP?

**Because for someone who can't see the screen, "probably clicked the right thing" is not good
enough.** A DOM/pixel agent _infers_ what a control does and can silently mis-click — and the user
can't visually catch it. WebMCP changes the guarantee:

- The page publishes **named, typed tools with descriptions** (`document.modelContext.registerTool`),
  so the agent invokes a **known action** — `submit_refill` — not a guessed-at button.
- The tools are **scoped to the current step** (via `AbortController`): on the _prescriptions_
  step the agent can `set_prescription`; only on _review_ can it `submit_refill`. The page keeps
  the agent on-rails.
- The committing action is reached only after a **spoken read-back plus explicit confirmation
  attestation** bound to that exact local review, and the authoritative commit runs **server-side
  with an ETag compare-and-swap** — so if the record
  changed underneath (a refill already processed, a dose updated), the submit **fails closed**
  with an actionable message instead of doing the wrong thing quietly.

That reliability floor — _the page declares the exact action, binds the read-back to the current
proposal, and refuses a stale commit_ — is what a scrape-the-DOM agent cannot obtain from control
labels alone. Human confirmation remains the browser agent's responsibility; ExactCue proves
payload binding and freshness rather than pretending it can infer spoken assent. **That is the
load-bearing role of WebMCP here.**

## Scope note (read this before calling it a mock)

WebMCP requires the _page_ to expose the tools, so this demo runs on our own pharmacy app. That's
the point, not a dodge: the WebMCP layer is a **small typed adapter** a site adds over the app it
already has (`src/webmcp/exactCueTools.ts` is that layer here). We deliberately
built **one deep, real flow** — real state, server-authorized submit, a real stale-record
fail-closed on camera — rather than a wide set of shallow fakes.

## How it maps to the judging rubric

- **WebMCP Leverage** — real `document.modelContext` tools are the _only_ control plane for the
  agent; the tool set changes with task state, visible live in the app and the Model Context Tool
  Inspector; the server-side ETag CAS is genuine, not simulated.
- **Execution** — a complete, coherent product: a fully usable human UI, plus empty /
  unsupported-browser / ineligible-prescription / stale-record / success states.
- **Potential Impact** — a specific audience and costly failure mode: a non-sighted user cannot
  visually catch a wrong or stale transactional action. The demo is synthetic and claims a
  reusable safety pattern, not clinical deployment or completed user research.
- **Creativity & Ambition** — accessibility as an **agent cockpit**, not an accessibility _audit_
  tool; the inverse of the crowded "confirmation-gated governance" pattern.

## How WebMCP is implemented

- `src/webmcp/modelContext.ts` — typings + helpers for the experimental imperative API.
- `src/domain/refill.ts` — the pure, tested state machine (steps, eligibility, validation, submit).
- `src/store.ts` — one shared order that both the React UI and the tool handlers read/mutate, so
  the page and the agent always look at the same uncommitted review state.
- `src/webmcp/exactCueTools.ts` — the typed WebMCP adapter. Always-on tools describe and recover;
  navigation and action tools register and retire with the current step. At review,
  `go_to_next_step` disappears and only the read-back + explicit-confirmation submit path can
  reach authoritative completion.
- `src/server/orderService.ts` — validates the proposed refill against the current authoritative
  catalog and makes the ETag/version compare-and-swap decision.
- `src/server/netlifyBlobOrderRepository.ts` — strong Blob reads plus the production
  `onlyIfMatch` conditional write. A stale or replayed token returns the current record and never
  commits the proposal.
- `src/api/demoSession.ts` — bounded, path-safe synthetic run IDs. The run ID is visible in the
  URL and proof bar; it is not a credential or an authorization boundary.
- `netlify/functions/order.ts` — web-standard `GET /api/order` and `POST /api/order` Function.
- `src/App.tsx` — the human UI and a live panel mirroring `getTools()` so you can watch the tool
  set change per step.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5820 (headers + labeled local proof server)
pnpm test       # domain, CAS, replay, and HTTP contract tests
pnpm build      # typecheck + production build to dist/
pnpm preview    # built artifact + labeled local proof server on :5820
pnpm smoke:ui   # WebMCP-executed refill + stale-write/recovery proof
pnpm capture:demo # real hosted conflict-to-recovery insert
pnpm scan:secrets
```

The judge-facing [demo run-of-show](./submission/DEMO_RUN_OF_SHOW.md) and
[upload metadata](./submission/VIDEO_DESCRIPTION.md) keep the final video under three minutes.
The capture command drives the public deployment through native WebMCP and writes its ignored MP4
to `.artifacts/demo/exactcue-proof.mp4`.

To see the agent drive it, open the app in **Chrome 149+** with
`chrome://flags/#enable-webmcp-testing` enabled (plus the _Model Context Tool Inspector_
extension), or the **ChatGPT desktop** in-app browser. Without WebMCP the page runs in fully
usable manual mode and says so.

## Deploy (Netlify)

`netlify.toml` sets the required headers (`Origin-Agent-Cluster: ?1`,
`Permissions-Policy: tools=(self)`), publishes `dist/`, and bundles `netlify/functions/` on Node
22.12+. On Netlify the Function opens the site-wide `exactcue-orders` Blob store. First read
creates the synthetic aggregate with `onlyIfNew`; submit performs a strong read followed by
`setJSON(..., { onlyIfMatch: etag })`. A losing writer receives HTTP 409 with the current record.
Each browser run receives a validated `demo-<uuid>` session in the URL and an isolated key under
`sessions/<session>/marcus-refill`, so a judge can start a fresh synthetic demo without deleting a
prior receipt. Malformed/path-like IDs are rejected before storage is opened.

Every order response includes `X-ExactCue-Request-Id`, `X-ExactCue-Storage`, and `Server-Timing`
receipts. The hosted Function logs only that request ID, method, status, duration, and storage mode;
it deliberately excludes URL/session IDs, ETags, request/response bodies, and patient/order fields.

Live judge preview: <https://iteration-3-cas--exactcue-webmcp.netlify.app>

Local Vite dev/preview serves the **same HTTP handler and service logic** over an in-memory adapter,
visibly labeled `LOCAL PROOF SERVER`. That makes offline tests and deterministic conflict rehearsal
cheap, but it is not presented as hosted Blobs proof. The public preview has separately returned
`X-ExactCue-Storage: netlify-blobs` and passed a real hosted matching commit, stale 409/no-write,
replay rejection, recovery, session-isolation, and anonymous reachability check.

Current Netlify implementation references: [Blobs conditional writes](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
and [web-standard Functions](https://docs.netlify.com/build/functions/get-started/).

## Scope & safety

ExactCue is a **coordination/reference** implementation. It gives no medical advice and makes no
clinical judgement. All people, prescriptions, pharmacies, and records are synthetic. No real
pharmacy integration or blind/motor-impaired participant study is claimed.

## License

MIT — see [LICENSE](./LICENSE).
