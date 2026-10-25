# CLAUDE.md: QuackTrack master guidance

Read this file first in every session. You have no memory of earlier sessions. These five documents are the project's memory: CLAUDE.md, GENRE.md, PRODUCT.md, SRS.md (Software Requirements Specification), SDS.md (Software Design Specification).

## What this project is

1. QuackTrack is a hackathon submission system where one FIDO2 (Fast IDentity Online 2) security key is a team's identity.
2. Organizers create prompt assignments and assign one to each enrolled team.
3. A team sees its prompt only after a verified key tap, and the reveal time is logged.
4. A team signs its submission with a key tap whose WebAuthn (Web Authentication) challenge is derived from the SHA-256 hash of the submission content: project name, repo URL, commit SHA, description, and the build declaration sentence.
5. Organizers watch a live console with one row per team, backed by a hash chained action log.
6. One codebase runs in two modes with no code change. Local mode: one laptop at http://localhost:3000, where every team taps in on that laptop. Hosted mode: Render at an HTTPS origin, where teams use their own devices. WebAuthn works only on localhost or a real HTTPS origin, so multi device use is hosted mode only.
7. The organizer owns a reusable pool of keys and checks one out to each team at enrollment; a team may use its own key with organizer approval. A lost or broken key is replaced only through the logged OVERRIDE ceremony (SRS.md FR-41).

## The stack (verbatim)

Stack (locked): plain JavaScript, Node + Express, @simplewebauthn/server and @simplewebauthn/browser, in-memory store only, runs at http://localhost:3000 by default with rpID "localhost" by default, but PORT, RP_ID, ORIGIN, SESSION_SECRET, AI_PROVIDER, GEMINI_API_KEY, OLLAMA_URL, and OLLAMA_MODEL must come from environment variables so the same code can run locally and on Render without a code change (defaults must work with no env vars set at all, with the FAQ falling back to the searchable bundle list when no AI provider is configured), sessions via a server side store keyed by a random session ID in an httpOnly cookie.

Pinned versions (decided in SDS.md section 1): @simplewebauthn/server 13.x and @simplewebauthn/browser 13.x. Node 20 or newer. Express 5.x. No other runtime dependencies.

## The laws (verbatim, priority order)

Laws (never break, priority order as listed): L1 server authority, identity only from a verified credential at ceremony tier and from a server issued session at read tier, never from client claims. L2 no prompt and no unrevealed team secret reaches any browser before that team's verified tap, in no payload, page, or page source. L3 one key, one team, one submission, no edits, no resubmission, no unsigned fallback. L4 fresh single use challenges, signing bound to the submission hash. L5 hash chained action log. L6 fail loud with a plain sentence readable from 10 feet. L7 if it does not serve the 60 second demo, cut it.

## How to work here

1. Before every task, read GENRE.md, PRODUCT.md, SRS.md, and SDS.md in full. Do not rely on a summary of them.
2. Do one build ticket per session. The tickets are in SDS.md section 12, and the cut lines are in section 13. Build in this order: T1 to T5, then T12 (built in Session 3 right after T5), then T6 to T8, then T11, then T9. T10 is cut (cut line 1) and is not built. Do not start a ticket whose dependencies are not done.
3. Build only what the ticket says. If the ticket needs something the SDS does not define, stop and say so.
4. Before you say a ticket is done, run its "Done when" test yourself as far as you can without a physical key (start the server, call the endpoints with curl, read the log). Then hand the human the steps that need a physical key and wait for their result.
5. Never add anything that breaks a law. If a request from the human conflicts with a law, say which law and why, and do not comply silently. Lower numbered laws win over higher numbered laws.
6. When a ticket creates or changes a file, update the file map below in the same session.
7. Never write a secret to any file on disk, including a git ignored .env file. When a command needs GEMINI_API_KEY or SESSION_SECRET, give the human one Terminal command with the value pasted inline, for example `AI_PROVIDER=gemini GEMINI_API_KEY=paste-key-here npm start`.
8. Git: work on the main branch only. Make one commit per ticket that includes every changed file. The human pushes. Do not create branches.
9. Every error a person can see is one plain sentence that says what happened and what to do next, copied from the error dictionary in SRS.md section 4A. Never invent a new sentence: if one is missing, stop and say so. No stack traces in any response or page.
10. Every page is static HTML plus static JavaScript. The server never puts data into HTML. All data arrives through the JSON (JavaScript Object Notation) endpoints in SDS.md section 4.

## File map

Keep this table current. A row marked "(planned T#)" means the file does not exist yet and ticket T# creates it. Remove the marker when the file exists.

| File | One job | Must never |
|---|---|---|
| CLAUDE.md | Master guidance read first | Drift from the laws or stack text |
| GENRE.md | Coding genre rules and decision tests | Contradict the law order |
| PRODUCT.md | Actors, ceremonies, demo script, open question defaults | Describe features the SRS does not require |
| SRS.md | Testable requirements, invariants, state machines | Contain a requirement without a failure case |
| SDS.md | Design, endpoints, tickets, cut lines | Design anything the SRS does not require |
| package.json | Dependencies and `npm start` | Add a dependency beyond express and the two @simplewebauthn packages |
| package-lock.json | Exact installed dependency versions, written by `npm install` | Be edited by hand |
| .gitignore | Keep node_modules, .env, and logs out of git | Be removed |
| LICENSE | MIT license text | Change license |
| README.md | How to run local mode and hosted mode, env var table | Contain a real key or secret |
| server.js | Create the Express app, guards, mount routes, serve the static receipt page at /receipt/:id, start listening | Hold business logic |
| src/config.js | Read env vars and apply defaults | Read any env var not in the stack list |
| src/errors.js | `fail(res, status, code, sentence)`, the error envelope, and the SRS.md section 4A dictionary | Send a stack trace or a sentence that is not in the dictionary |
| src/store.js | In-memory maps and `resetStore()` | Write to disk |
| src/validate.js | Schema checks, unknown field rejection, handle and URL rules, rate limiter | Read the store |
| src/canon.js | `norm`, `canon`, `sha256`, challenge and hash derivations | Use JSON.stringify on objects without key sorting |
| src/log.js | Append and verify the hash chained action log | Store prompt text, secret text, or chat text |
| scripts/verify-log.js | Verify an exported log file from the command line | Import anything from the running server |
| src/sessions.js | Mint, read, expire, and revoke sessions, set cookies | Accept a session ID that fails the HMAC check |
| src/webauthn.js | Wrap SimpleWebAuthn calls and the pending ceremony map | Reuse a challenge |
| src/routes/org.js | Organizer setup, login, console, prompts, assign, reset, seed | Answer a request without an organizer session |
| src/routes/enroll.js (override added in T11) | Draft teams, key source, enroll ceremony, roster removal, console team rows with submission columns, override ceremony | Put a member on a roster (members join through tap.js), or finish an override without the organizer tap |
| src/routes/tap.js | Team tap ceremony, join (T12), reveal, client failure report | Mint a session without a verified assertion |
| src/routes/team.js | Read tier team room with its submission summary, member select, download | Take a team ID from the request |
| src/routes/sign.js | Sign ceremony, submission creation with the signed roster copy, repo owner check | Create a submission without a verified assertion |
| src/routes/public.js | Public team list and receipts with their three checks | Return a prompt, secret, or roster, except the signed roster copy on a receipt |
| src/ai/askFAQ.js (planned T8) | Pick provider, enforce grounding, refusal, unanswered log | Read the store beyond the context bundle |
| src/ai/gemini.js (planned T8) | Call the Gemini API | Log or return the API key |
| src/ai/gemma.js (planned T8) | Call Ollama | Call any host except OLLAMA_URL |
| src/routes/faq.js (planned T8) | FAQ ask and bundle read endpoints | Change any state except the unanswered list and log |
| src/routes/commons.js (planned T9) | Team chat, public commons, moderation | Trust a team or handle sent by the client |
| src/drama.js (planned T9) | Turn log entries and deadlines into public system posts | Read prompt or secret fields |
| src/routes/secrets.js (parked: T10 cut by cut line 1) | Organizer notes, secret issue, secret reveal tap | Send a secret body before its reveal tap |
| public/index.html | Landing page with links | Contain event data |
| public/favicon.svg, public/favicon.ico, public/apple-touch-icon.png | The QuackTrack icon for browser tabs and phone home screens | Contain event data |
| public/css/app.css | All styles, including the fail banner | Set error text below 32px |
| public/js/api.js | `api()` fetch wrapper and `showFail()` banner | Use innerHTML with server data |
| public/privacy.html | Plain words privacy policy: what is stored, never stored, memory only, contact | Claim anything the code does not do |
| public/support.html | Plain words help: organizer desk, lost or broken key, common problems, GitHub Issues | Link to the organizer console |
| public/setup.html, public/js/setup.js | Organizer first credential enrollment | Work without the setup token |
| public/console.html, public/js/console.js | Organizer console | Cache data in localStorage |
| public/team.html, public/js/team.js | Team picker and tap in | Show anything about a prompt |
| public/room.html, public/js/room.js | Team room, sign form, locked signing panel, receipt moment, `QT_TEST.tamperSign` | Render any field with innerHTML |
| public/receipt.html, public/js/receipt.js | Public receipt and its verification checks | Show the prompt |
