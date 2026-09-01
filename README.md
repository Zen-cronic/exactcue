# Handsfree

**The web, operated by _your_ agent — for people who can't operate it themselves.**

Handsfree is a WebMCP web app that lets a blind or motor-impaired person complete a real,
multi-step task — refilling prescriptions and choosing a pickup pharmacy — entirely by talking to
their own browser agent. The page exposes clean, _semantic_ WebMCP tools, so the agent performs
the actual steps of the task in the user's own session, and **reads the order back for the user to
confirm out loud before anything is submitted.**

> Meet Marcus. He's blind. Today, refilling his prescriptions means fighting a form built for a
> mouse. With Handsfree he says, _"refill my cholesterol and blood-pressure meds for pickup at
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
- The committing action is reached only after a **spoken read-back the human confirms**, and the
  authoritative commit runs **server-side with an ETag compare-and-swap** — so if the record
  changed underneath (a refill already processed, a dose updated), the submit **fails closed**
  with an actionable message instead of doing the wrong thing quietly.

That reliability-and-consent floor — _the page promises the exact action, and a non-sighted user
confirms it before it commits_ — is what a scrape-the-DOM agent can't guarantee, and it's exactly
what this user needs. **That's the load-bearing role of WebMCP here.**

## Scope note (read this before calling it a mock)

WebMCP requires the _page_ to expose the tools, so this demo runs on our own pharmacy app. That's
the point, not a dodge: the WebMCP layer is a **small typed adapter** a site adds over the app it
already has (`src/webmcp/handsfreeTools.ts` is that layer here). We deliberately
built **one deep, real flow** — real state, server-authorized submit, a real stale-record
fail-closed on camera — rather than a wide set of shallow fakes.

## How it maps to the judging rubric

- **WebMCP Leverage** — real `document.modelContext` tools are the _only_ control plane for the
  agent; the tool set changes with task state, visible live in the app and the Model Context Tool
  Inspector; the server-side ETag CAS is genuine, not simulated.
- **Execution** — a complete, coherent product: a fully usable human UI, plus empty /
  unsupported-browser / ineligible-prescription / stale-record / success states.
- **Potential Impact** — a named, specific audience (blind and motor-impaired users) and a real,
  common friction (multi-step transactional forms). Coordination only, no medical advice.
- **Creativity & Ambition** — accessibility as an **agent cockpit**, not an accessibility _audit_
  tool; the inverse of the crowded "confirmation-gated governance" pattern.

## How WebMCP is implemented

- `src/webmcp/modelContext.ts` — typings + helpers for the experimental imperative API.
- `src/domain/refill.ts` — the pure, tested state machine (steps, eligibility, validation, submit).
- `src/store.ts` — one shared order that both the React UI and the tool handlers read/mutate, so
  the page and the agent always look at the same uncommitted review state.
- `src/webmcp/handsfreeTools.ts` — the typed WebMCP adapter. Always-on tools
  (`describe_current_step`, `reload_current_record`, `go_to_next_step`, `go_back`) orient,
  recover, and move; step-scoped tools
  (`set_prescription`, `set_pharmacy`, `review_order`, `submit_refill`) register and unregister as
  the flow advances.
- `src/server/orderService.ts` — validates the proposed refill against the current authoritative
  catalog and makes the ETag/version compare-and-swap decision.
- `src/server/netlifyBlobOrderRepository.ts` — strong Blob reads plus the production
  `onlyIfMatch` conditional write. A stale or replayed token returns the current record and never
  commits the proposal.
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
pnpm smoke:ui   # two-session stale-write proof in headless Chrome
pnpm scan:secrets
```

To see the agent drive it, open the app in **Chrome 149+** with
`chrome://flags/#enable-webmcp-testing` enabled (plus the _Model Context Tool Inspector_
extension), or the **ChatGPT desktop** in-app browser. Without WebMCP the page runs in fully
usable manual mode and says so.

## Deploy (Netlify)

`netlify.toml` sets the required headers (`Origin-Agent-Cluster: ?1`,
`Permissions-Policy: tools=(self)`), publishes `dist/`, and bundles `netlify/functions/` on Node
22.12+. On Netlify the Function opens the site-wide `handsfree-orders` Blob store. First read
creates the synthetic aggregate with `onlyIfNew`; submit performs a strong read followed by
`setJSON(..., { onlyIfMatch: etag })`. A losing writer receives HTTP 409 with the current record.

Local Vite dev/preview serves the **same HTTP handler and service logic** over an in-memory adapter,
visibly labeled `LOCAL PROOF SERVER`. That makes offline tests and deterministic conflict rehearsal
cheap, but it is not presented as hosted Blobs proof. The true provider path must still be verified
on the Netlify preview before submission.

Current Netlify implementation references: [Blobs conditional writes](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
and [web-standard Functions](https://docs.netlify.com/build/functions/get-started/).

## Scope & safety

Handsfree is a **coordination** tool. It gives no medical advice and makes no clinical judgement.
All data is synthetic.

## License

MIT — see [LICENSE](./LICENSE).
