# Handsfree

**The web, operated by _your_ agent — for people who can't operate it themselves.**

Handsfree is a WebMCP web app that lets a blind or motor-impaired person complete a real,
multi-step task — refilling prescriptions, choosing insurance, scheduling a delivery — entirely
by talking to their own browser agent. The page exposes clean, _semantic_ WebMCP tools, so the
agent doesn't wrestle with the DOM; it performs the actual steps of the task in the user's own
session, and the human confirms before anything is submitted.

> Meet Marcus. He's blind. Today, refilling three prescriptions means fighting a form built for a
> mouse. With Handsfree he says, _"refill my cholesterol and blood-pressure meds and have them
> delivered Thursday"_ — and watches (well, hears) it happen.

## Why this needs WebMCP — and couldn't really exist without it

A screen reader lets a disabled user **read** a page and operate it **one control at a time, by
hand**. It does not let their intelligent agent **do a whole task for them**. To get an agent to
actually carry out a multi-step task on a live site, before WebMCP you had exactly two options,
and both fail here:

1. **A public API + credential handoff.** Most apps have no such API, and handing an autonomous
   agent blanket credentials to act on your account is exactly the risk you don't want.
2. **Screen-scraping the DOM.** Brittle, unsafe, and it breaks the moment the layout changes.

**WebMCP is the missing piece:** the page itself publishes structured, semantic tools
(`document.modelContext.registerTool`) that the user's _own_ agent invokes **inside the user's
authenticated session**, on the very page a sighted person would see. Handsfree adds one property
on top: **the available tools are scoped to the current step of the task.** On the
_prescriptions_ step the agent can `set_prescription`; on _review_ it can `submit_refill`. The
page — not the agent, not a static tool manifest — decides what is possible right now, and the
one committing action (`submit_refill`) is only ever taken after the human confirms the read-back.

So the thing people and agents can do together that was hard-to-impossible before: **a person who
cannot comfortably operate a page can now delegate the _whole task_ to their agent, safely, on the
real page, with the page keeping the agent on-rails and the human in the loop.**

## How it maps to the judging rubric

- **WebMCP Leverage** — real `document.modelContext` tools that are the _only_ control plane for
  the agent; the tool set changes with task state (via `AbortController`), which is visible live
  in the app and in the Model Context Tool Inspector.
- **Execution** — a complete, coherent product: a normal, fully usable human UI, plus empty /
  unsupported-browser / error / success states, plus the same task exposed to the agent.
- **Potential Impact** — a named, specific audience (blind and motor-impaired users) and a real,
  common friction (multi-step transactional forms) — coordination only, no medical advice.
- **Creativity & Ambition** — accessibility as an **agent cockpit**, not an accessibility _audit_
  tool; the inverse of the crowded "confirmation-gated governance" pattern.

## How WebMCP is implemented

- `src/webmcp/modelContext.ts` — typings + helpers for the experimental imperative API.
- `src/domain/refill.ts` — the pure, tested state machine (steps, selection, validation, submit).
- `src/store.ts` — one shared order that both the React UI and the tool handlers read/mutate, so
  the page and the agent are always looking at the same live state.
- `src/webmcp/handsfreeTools.ts` — the tool surface. Always-on tools (`describe_current_step`,
  `go_to_next_step`, `go_back`) orient and move; step-scoped tools (`set_prescription`,
  `set_insurance`, `set_fulfillment`, `review_order`, `submit_refill`) register and unregister as
  the flow advances.
- `src/App.tsx` — the human UI and a live panel mirroring `getTools()` so you can watch the tool
  set change per step.

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173  (dev server sends the WebMCP headers)
pnpm test       # domain state-machine tests
pnpm build      # typecheck + production build to dist/
```

To see the agent drive it, open the app in **Chrome 149+** with
`chrome://flags/#enable-webmcp-testing` enabled (plus the _Model Context Tool Inspector_
extension), or the **ChatGPT desktop** in-app browser. Without WebMCP the page runs in fully
usable manual mode and says so.

## Deploy (Netlify)

`netlify.toml` sets the required headers (`Origin-Agent-Cluster: ?1`,
`Permissions-Policy: tools=(self)`) and publishes `dist/`. Netlify Deploy Previews are public, so
judges can reach the live URL without a login wall.

## Scope & safety

Handsfree is a **coordination** tool. It gives no medical advice and makes no clinical judgement.
All data is synthetic.

## License

MIT — see [LICENSE](./LICENSE).
