# GENRE.md: the coding genre of QuackTrack

QuackTrack samples three coding genres into one track. When two genres disagree, the higher one in this list wins: 1. Crypto protocol coding, 2. Roblox dev coding, 3. Hackathon freestyle. Use the DECISION TEST of each genre on every design choice and every code review.

Terms used here: a "ceremony" is one WebAuthn (Web Authentication) key tap that the server verifies. A "challenge" is the random or derived bytes the key signs. A "Remote" is the Roblox name for a call from client to server; here it means any HTTP (HyperText Transfer Protocol) endpoint.

---

## 1. Crypto protocol coding

**NOTICES FIRST**
- Where a challenge is created, where it is stored, and the exact moment it is deleted.
- Every place bytes turn into text or text turns into bytes (hex, base64url, UTF-8). Two encodings of the same bytes never compare equal as strings.
- Any code path where an action happens without a verified assertion.
- Any value the client sends that the server then trusts as identity.
- Whether a hash covers all the fields it claims to protect, in a fixed order.

**SCAR TISSUE**
- A challenge kept only in the client, or sent back by the client, lets the client pick its own challenge. Store it on the server.
- A challenge that is only a hash of the content is the same every time the content is the same, so an old signature replays. Mix in a fresh server nonce.
- Hashing `JSON.stringify(object)` breaks when key order changes. Hash a canonical form with a fixed order.
- A challenge that is deleted only after success can be retried until an attacker gets lucky with timing. Delete it before verifying.
- Signature counters that go backwards are the only hint a key was cloned. Ignoring the thrown error hides it.
- A log that can be edited in place tells you nothing. Each entry must commit to the one before it.

**HEURISTICS**
1. Delete the pending ceremony from the map before you call `verifyAuthenticationResponse` or `verifyRegistrationResponse`, so it is single use even when verification throws.
2. Compute every hash from `canon()` output in src/canon.js. Reject any code that hashes `JSON.stringify(obj)` directly.
3. Recompute the signing challenge on the server from the content in the verify request plus the stored nonce. Never accept a challenge value from the client.
4. Pass `requireUserVerification: false` explicitly on every verify call. Never rely on the library default.
5. Compare challenge strings only in base64url form. Convert with `Buffer.toString('base64url')` and assert it equals `options.challenge` right after generating options.
6. Write the new counter back only after a successful verification. Treat a counter error as a cloned key alert, log it, and fail loud.
7. Never log prompt text, secret text, or chat text. Log IDs, hashes, handles, and times.
8. Give every hash input a version prefix such as `quacktrack-sign-v1`, so a hash from one purpose can never be valid for another.

**TASTE**
- Small pure functions for hashing and challenge building, with no access to the store.
- Hex for hashes shown to humans, base64url for WebAuthn fields, raw Buffers everywhere in between.
- Every ceremony has exactly two endpoints: options and verify.

**REJECTS**
- Passwords, PINs (personal identification numbers), shared codes, NFC (near field communication) tag IDs, or magic links as identity.
- "Remember this device" flags that skip a ceremony.
- Any unsigned fallback when a key is lost or a browser misbehaves.
- Custom signature verification code when SimpleWebAuthn already does it.

**DECISION TEST**
"Could someone holding the wrong key, or replaying a message they captured, get this accepted?"

---

## 2. Roblox dev coding

**NOTICES FIRST**
- Every field in a request body, and which ones the server uses to decide who is acting.
- State changes that happen without a state machine check from SRS.md section 7.
- Async gaps: anything that checks state, then awaits, then writes state.
- What the client is shown versus what the client is allowed to do.
- What a player could do in the first 60 seconds with DevTools open.

**SCAR TISSUE**
- Remotes that accept a "player" argument get exploited. The server already knows who is calling: from the session or from the verified key.
- Client side checks are decoration. A disabled button can still be clicked from the console.
- Two requests that both pass a check before either one writes can both succeed. Re-check right before the write.
- Rendering player text with innerHTML lets a player run script in everyone's browser.

**HEURISTICS**
1. Take the team ID at read tier only from `req.session.teamId`. Read tier schemas have no `teamId` field, so a request that sends one is rejected as an unknown field.
2. Validate every request body and query against the schema in SDS.md section 4 before touching the store. Reject unknown fields, wrong types, and lengths over the limit with a 400 and a plain sentence.
3. Check the state machine transition right before the write, after the last `await`, in the same synchronous block as the write.
4. Render every server string with `textContent` or `createTextNode`. Never use innerHTML with data.
5. Rate limit every endpoint that writes, with the limits in SDS.md section 4.
6. Make the console a pure view of server state, polled every second. Never let the console hold state the server does not have.
7. Return the full new state after a write, so the client never guesses.
8. Name the abuse case for every endpoint in its table row. If you cannot name one, you have not thought about it yet.

**TASTE**
- One store module, one log module, thin route files that validate, check state, write, log, respond.
- State machines written as explicit allowed transition tables.
- The host (organizer) sees everything. Players (teams) see only their own state plus the public commons.

**REJECTS**
- Trusting `credentialType`, `authenticatorAttachment`, `teamId`, `handle`, or `role` because the client sent it.
- Hidden admin endpoints without organizer session checks.
- WebSockets or extra infrastructure when one second polling works.

**DECISION TEST**
"If the client sends a lie here, does the server catch it before any state changes?"

---

## 3. Hackathon freestyle

**NOTICES FIRST**
- Whether this work shows up in the 60 second demo in PRODUCT.md section 7.
- How many minutes are left versus the ticket size.
- Anything that makes the demo depend on network, a second laptop, or luck.
- Whether a failure on stage would be visible and clear from 10 feet.

**SCAR TISSUE**
- Deploy and polish work started late eats the time needed to rehearse the demo.
- A feature that cannot be seen on stage still costs debugging time.
- Demos fail on setup steps, not on the code: wrong origin, wrong key, a browser dialog nobody expected.

**HEURISTICS**
1. Build the ticket's "Done when" test path first, then everything else in the ticket.
2. Use plain HTML forms and one CSS (Cascading Style Sheets) file. No frameworks, no build step.
3. Seed demo data with one button so the demo never starts from typing.
4. Make every state visible on the console with color: red for not yet, green for done.
5. When a ticket runs 20 minutes over, stop and apply the next cut line in SDS.md section 13.
6. Rehearse the demo with both physical keys after T7, before any later ticket.
7. Keep error sentences short enough to read aloud on stage.

**TASTE**
- Three ceremonies that feel like magic: Enroll, Reveal, Sign.
- Big type, high contrast, one action per screen.
- The console projected on a screen while the team page runs in a second window.

**REJECTS**
- Settings pages, user profiles, email, OAuth (Open Authorization) logins, databases, charts.
- Anything a judge cannot see, touch, or break in 60 seconds.

**DECISION TEST**
"Will someone see, touch, or break this during the 60 second demo?"

---

## CONFLICTS

Priority order: 1. Crypto protocol coding, 2. Roblox dev coding, 3. Hackathon freestyle. The law order in CLAUDE.md sits above all three.

Rule: correctness wins inside a ceremony. Freestyle wins everything around it.

**Worked example.** At hour six the Sign ceremony fails in rehearsal with "challenge mismatch" in Safari, and 40 minutes remain.
- Freestyle says: save the submission unsigned and mark the team green so the demo works.
- Crypto says: that is an unsigned fallback, which breaks L3, and a green row without a signature is a lie on the console.
- Resolution by priority: inside the ceremony, crypto wins. The submission stays unsigned and the row stays red. No fallback is written.
- Around the ceremony, freestyle wins: demo on Chrome where signing works, cut the receipt page styling, use the demo seed to prefill fields, and spend the remaining time rehearsing. Record the Safari issue in the README as a known issue.
