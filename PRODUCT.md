# PRODUCT.md: what QuackTrack is and how it behaves

Terms: FIDO2 (Fast IDentity Online 2) is the standard behind security keys such as a YubiKey. WebAuthn (Web Authentication) is the browser interface for FIDO2. A "passkey" here means a platform credential stored in a laptop or phone and unlocked with Touch ID or Face ID. A "tap" is one WebAuthn ceremony the server verifies. AI means artificial intelligence. FAQ means frequently asked questions.

## 1. Pitch

QuackTrack is Canvas for hackathons, without the forms. Today submissions run on forms, shared links, and spreadsheets, so anyone with a link can submit as any team, swap a team's submission, or say a prompt never arrived, and nobody can prove what changed. In QuackTrack one physical security key is a team's identity. A team sees its assigned prompt only after a verified tap, and the server logs the moment. A team submits by tapping again, and that tap signs the SHA-256 hash of the exact project name, repo link, commit SHA (the commit ID from git), description, and a sentence declaring the project was built during the event, so any later change breaks the signature and the receipt names the exact commit to judge. Organizers watch a live console that flips each team from red to green, backed by a hash chained log that shows any silent edit. The organizer buys a reusable pool of keys once and lends one to each team, so the cost is per team, not per student. QuackTrack runs free on one laptop at localhost, or hosted on Render so teams can use their own devices (section 10).

## 2. Actors

| Actor | Can | Cannot |
|---|---|---|
| Organizer | Enroll the first organizer credential with the setup link printed on the server terminal. Log in to the console with a tap. Create prompt assignments. Create draft teams (a name and a credential mode). Remove a roster member at any time (Session 3). Run the Enroll ceremony at the organizer desk, checking out a pool key or approving a team's own key. Replace a lost or broken key with the OVERRIDE ceremony, which needs the organizer's own tap. Assign and reassign prompts before reveal. Issue team secrets and notes (parked). Set the FAQ context bundle. Pin, delete, and mute in the commons. Read the log and verify the chain. Reset the event. Load demo data. | Reveal a prompt as a team. Sign or edit a submission. Put a person on a team's roster (members join themselves with the team's key, Session 3). Replace a team's key without tapping the organizer credential. Reassign a prompt after reveal. Edit or delete log entries. |
| Team Captain | Bring the team key to the organizer desk. Tap to enroll. Tap to reveal the prompt (team secrets are parked). Tap to sign the submission. Everything a Team Member can do. | Enroll a second key. Submit twice. Edit a submission. See another team's room. |
| Team Member | Join the team's roster on /team by typing their GitHub handle, display name, and role and tapping the team's key (Session 3). After the team has a session in a browser, select themselves as the person at the keyboard, read the room, download revealed instructions, chat in the team room, post in the commons, ask the FAQ assistant. Tap the key if they hold it. | Act at ceremony tier without the key. Post as a handle not on their roster. |
| Judge/Observer | Watch the projected organizer console, including roster handles. Open any receipt page by its link and see its roster handles, commit, and three verification checks. | Log in. See prompts, secrets, team rooms, team chat, or The Quad. |
| Adversary | Anyone in the room with a second key, DevTools, a stolen cookie, a captured request, or a refresh button. | Reveal another team's prompt, sign for another team, replay a tap, change a signed submission, or edit the log without the chain breaking. |

## 3. Roster model

Changed in Session 3 (October 25, 2026): members join themselves. The organizer never types handles.

- A team is people bound to one credential.
- The organizer creates a draft team (name and credential mode: "Security key" or "Solo passkey") and enrolls its key at the desk. Enrollment needs no roster.
- Members join on /team: pick the team, choose "I'm new to this team", type GitHub handle, display name, and role, and tap the team's key. That one tap opens the room and adds them to the roster (FR-42). Example: the Team Mallard key goes around the table; Jason taps and types `jasonepage` and becomes Captain, then his teammate taps and types `quack-builder`, Builder.
- Roles: Captain, Builder, Designer, Presenter. The first member to join is the Captain. Later members pick Builder, Designer, or Presenter. If the team has no Captain (for example the Captain was removed), the next member to join becomes Captain.
- A roster has at most 6 members. Solo passkey mode has at most 1.
- A GitHub handle can appear on only one roster in the event. Handles are compared lowercase.
- The organizer can remove a member at any time, with no tap (FR-43). Once the team submits, nobody can join. Joins and removals are logged. The Sign tap covers the roster, so a receipt always shows the roster the team signed.
- There is no GitHub login. The handle is a claim the member makes with the team's key in hand. The console checks whether the submission repo owner matches a roster handle and shows the result. It never blocks.
- Members who leave, merges, dissolves, and renames follow the rules in section 11.

## 4. Sessions and action tiers

Cookies remember, keys prove.

- A verified team tap sets an httpOnly cookie named `qt_team` that logs that browser in as that team for 8 hours.
- A verified organizer tap sets a separate cookie named `qt_org`. One browser can hold both, so the console and a team page can run in two windows of the same browser.
- A new team tap in the same browser replaces that browser's team session.
- **Read tier (cookie is enough):** open the team room, re-read or download revealed instructions (downloads are logged), view the roster, select the member at the keyboard, read and post team chat, read and post in the commons, read organizer notes, read secrets already revealed, ask the FAQ assistant. Organizer console actions also run on the organizer cookie.
- **Ceremony tier (fresh tap, cookie ignored for identity):** enroll a key, first reveal of the assigned prompt, first reveal of a team secret, sign a submission, organizer setup, organizer login.

## 5. Team room contents

Only the team's own session can open it. It shows:
1. Team name, credential label ("Security key" or "Platform passkey"), key source, the deadline, and "Your key was replaced by organizer override." when that happened.
2. "Who is at the keyboard?" selector listing the roster. Chat and commons posts need a selection.
3. Revealed prompt (track and instructions) with a Download button, a sealed card with a "Tap to reveal" button, or "No prompt is assigned to Team Mallard yet."
4. Roster with handles, display names, and roles.
5. Team chat, newest at the bottom, each message showing handle, role, and time, under the lines "Only your team sees this chat in QuackTrack. The organizer runs the server, so never post passwords or keys." and "Messages cannot be edited or deleted."
6. Organizer board: notes and team secrets. Parked by cut line 1, not built in the window.
7. FAQ assistant box, or the searchable event information list when no AI provider works.
8. Submission form (project name, repo link, commit SHA, description, build declaration box) that becomes a locked signing panel with the short hash before the tap, or the receipt link after signing.
9. The Quad (the public commons) in a side panel.
10. A "Leave room" button. On the shared host laptop in local mode the room also shows "Shared laptop: click Leave room when you are done."

## 6. The three ceremonies

### Enroll (at the organizer desk, organizer session required)
1. Organizer clicks "New team", types a name, picks a credential mode. Fails if the name is taken: "A team named Team Mallard already exists. Pick another name."
2. Nobody types a roster at the desk (Session 3). Members join later on /team with the team's key (section 3).
3. Organizer sets the key source on the row (section 11): Pool key with its tag color and pool label, or Team's own key with the approval box ticked. The row shows the tag rule: a bright tag with only the team name and "Return to the organizer desk", never a credential ID or PIN. Organizer clicks "Enroll with key". The server builds a challenge bound to the team and its (usually empty) roster hash.
4. The browser asks for the key. The captain taps. If the key is already enrolled anywhere, the browser refuses and QuackTrack shows "This key is already enrolled to another team or the organizer. Use a different key." If the person cancels: "The key tap was cancelled. Nothing was enrolled."
5. The server verifies, checks the credential is new, labels it, computes its key fingerprint, and logs `team.enrolled`. Fails if a "Security key" enrollment produced a synced or platform credential: "This looks like a passkey, not a physical security key. Use the key, or create the team as Solo passkey." Fails if the tap was too slow: "This tap expired. Click Enroll again."
6. Console row shows ENROLLED, the credential label, the key source and tag, and the fingerprint. The roster fills in as members join.

### Reveal (team page: the host laptop in local mode, any device at the HTTPS origin in hosted mode)
1. A member opens /team and picks the team name from the list of enrolled teams.
2. The server issues a fresh challenge that only this team's credential may answer. Fails if the team is a draft: "Team Mallard is not enrolled yet. Enroll at the organizer desk."
3. The member taps. With the wrong key the browser refuses, and QuackTrack shows "That was not Team Mallard's key, or the tap was cancelled. Nothing was revealed." and reports the failed tap to the console log. The browser gives a wrong key, a cancel, and a timeout the same error, so the sentence names both.
4. The server verifies the assertion against this team's credential only, deletes the challenge, updates the counter, and mints a team session. Fails on replay: "This tap was already used. Tap your key again." Fails on counter regression: "This key's counter went backwards, which can mean a cloned key. Ask the organizer."
5. If a prompt is assigned and not yet revealed, the server marks it revealed with the time, logs `prompt.revealed`, and returns the prompt in this response only. If none is assigned, the room opens with "No prompt is assigned to Team Mallard yet."
6. The room shows the prompt. The console row shows "Revealed" with the time.

### Sign (team room)
1. A member fills project name, repo link, commit SHA (the output of `git rev-parse HEAD`), and description, ticks the build declaration box labeled "We declare that this project was built during this event.", and clicks "Sign submission". Fails if the prompt is not revealed: "Reveal your prompt before you submit." Fails after the deadline: "The deadline has passed. Submissions are closed for Team Mallard." Fails if already submitted: "Team Mallard already submitted. Submissions cannot be changed." Fails on a short commit: "The commit must be the full 40 character ID from git rev-parse HEAD." Fails without the box: "Tick the build declaration before you sign."
2. The server normalizes and hashes the content, adds a fresh nonce, builds the challenge, and returns the options plus the short hash. The form becomes a locked panel showing the five values and "You are signing hash 3fa2c9e1. Tap your key." with the hash in large type (SRS.md FR-38).
3. The member taps. Wrong key or cancel: "The submission was not signed. Nothing was submitted."
4. The server re-hashes the content sent with the assertion. If it differs from the hash it issued: "The submission changed after you started signing. Nothing was submitted." It verifies the assertion against the team's credential with the recomputed challenge, re-checks the team state, creates the submission, and logs `submission.signed`.
5. The room shows "Signed. Receipt 3fa2c9e1." and the receipt link. The console row turns green with the time and the short hash.

## 7. The 60 second demo

Setup before the clock starts: server running on the stage laptop at http://localhost:3000. Organizer logged in on the console window. "Load demo data" clicked, which created two prompts (tracks "Duck Pond Sensors" and "Quack Commons"), the FAQ bundle, and two draft teams with rosters: Team Mallard (2 members, Pool 01, yellow tag) and Team Teal (1 member, Pool 02, blue tag), both in Security key mode with their key fields prefilled. Key A has a yellow tag, key B a blue tag. A team window on /team sits beside the console. Project name, repo link, commit SHA, and description are in the clipboard notes.

| Time | Action | Expected screen state |
|---|---|---|
| 0:00 | Show the console. | Top strip "0 of 2 submitted" and a green "Log verified" badge. Two grey rows: Mallard and Teal, DRAFT, rosters listed, "Not enrolled", key fields "Pool 01 (yellow)" and "Pool 02 (blue)". |
| 0:05 | Click Enroll with key on Mallard, tap key A. | Mallard row: ENROLLED, "Security key", "Pool 01 (yellow)", fingerprint, roster locked. Log tail shows `team.enrolled`. |
| 0:12 | Click Enroll with key on Teal, tap key B. | Teal row: ENROLLED, "Security key", "Pool 02 (blue)". |
| 0:18 | Assign "Duck Pond Sensors" to Mallard and "Quack Commons" to Teal. | Both rows show the assigned track and a red "Not revealed". |
| 0:24 | In the team window pick Mallard, tap key B. | The browser shows its own "not registered" message. After it closes, a full width red banner: "That was not Team Mallard's key, or the tap was cancelled. Nothing was revealed." Console log tail shows `tap.client_failed` for Mallard. |
| 0:31 | Tap again with key A. | The room opens with the Duck Pond Sensors instructions. Mallard row: "Revealed 0:31" in green. Teal still red. |
| 0:37 | Paste project name, repo link, commit SHA, description. Tick the build declaration. Click Sign submission. | Locked panel: "You are signing hash 3fa2c9e1. Tap your key." in large type (hash differs per content) |
| 0:48 | Tap key A. | Room shows "Signed. Receipt 3fa2c9e1." and a receipt link. |
| 0:52 | Point at the console. | Top strip "1 of 2 submitted". Mallard row green: SUBMITTED, time, short hash matching the room, commit, repo owner check. Teal row red: not revealed, not submitted. Log verified. |
| 0:58 | Done. | |

Timing note: the commit field and the declaration box cost about 4 seconds, taken from the closing pause. The paste step is now the tightest part of the run, so rehearse it.

## 8. Out of scope

- Any password login. GitHub sign-in (OAuth, Open Authorization) is parked, see below.
- Adding a second key. A lost or broken key is replaced only by the OVERRIDE ceremony (SRS.md FR-41).
- Editing, withdrawing, or resubmitting a submission.
- Judging, scoring, or ranking.
- A database or any storage that survives a restart.
- More than one event per server.
- Multi device use in local localhost mode. Reason: WebAuthn works only on localhost or a real HTTPS (HyperText Transfer Protocol Secure) origin, so other laptops cannot reach the host's localhost as a valid origin. Hosted mode shows multi device use.
- Moving credentials between origins. A key enrolled on localhost must be enrolled again on the hosted origin.
- Enforcing trades. Trade offers are honor system chat posts.
- Email, notifications, file uploads, user profiles.
- Proving a key's maker through attestation certificates (see open question 6).
- Entry in the Best Use of Gemma 4 track. The Gemma path exists and is documented only.

Parked in Session 2 (real, but wrong for the 7 hour build):
- Key return tracking on the console (checked out, returned, unreturned at the deadline). Reason: not in the 60 second demo, and it did not fit the 6 hour ticket budget; the README key sheet records returns.
- Organizer notes and team secrets (SRS.md FR-17 to FR-19), including secret rules for per team or shared secrets, expiry at event end, and leak response. Reason: cut line 1, applied to make room for the key override.
- Random prompt draw. Reason: manual assignment is already logged per team (`prompt.assigned`), which is the fairness record.
- Broadcast announcements to every team room. Reason: not in the demo; the organizer announces out loud or pins a post in The Quad.
- Mentor help queue (request, order, table or topic, claimed). Reason: a new entity with its own states and screens, too large for the window.
- Demo order panel derived from submissions. Reason: the console's submitted times already give the order by eye.
- End of event export file. Reason: Download log already exports the full signed history, and each receipt downloads as JSON.
- Receipt lookup by pasting a hash. Reason: every receipt link already shows its hash and checks with no login and no key.
- Deadline extension. Reason: not in the demo. Until it exists, set deadlines with a buffer, because QuackTrack rejects a submission after the stored deadline even if an extension is announced.
- Countdown to the next deadline on the console strip. Reason: the deadline posts at 30 and 10 minutes cover it when T9 is built.
- Food claims per roster member. Reason: not in the demo.
- Hardware or resource checkout per team, other than the security keys. Reason: not in the demo.
- Recovering a lost organizer credential. Reason: the only recovery is a restart, which wipes the event; use a passkey on the host laptop so it cannot be lost apart from the laptop.

Parked in Session 3:
- GitHub sign-in to prove a member owns their handle. Reason: it needs a GitHub app, internet at the event, and accounts, which breaks the landing page promise "No account, no password". The key is the proof; the typed handle is a name tag. A stretch goal after the demo works.

## 9. OPEN QUESTIONS (each with the default chosen)

1. **How does the organizer prove identity?** The material gives the organizer powers but no login. Default: on boot the server prints a one time setup link to its own terminal. The organizer opens it and enrolls an organizer credential, usually a passkey on the host laptop, so both physical keys stay free for teams. Organizer login is a tap. Why: L1 forbids identity from anything but a credential or a session minted from one, and the stage needs both keys for teams.
2. **Where does enrollment happen?** Default: at the organizer desk, in the browser holding the organizer session, for both modes. A solo passkey team in hosted mode uses the browser's "use a phone" option to create the passkey on its own phone; passkey mode does not restrict attachment, so that option appears (SDS.md section 6.4). Whether "use a phone" works at http://localhost is not verified; T4 records it. If it does not, a local mode solo passkey lives on the host laptop, as the threat model already accepts. Why: an enrollment link sent to a team would be a bearer code anyone could use to enroll a different key.
3. **Does L2 cover the organizer's browser?** The organizer types the prompts, so they exist there. Default: L2 applies to every response that is not authorized by an organizer session. Why: the alternative is unbuildable, and the demo needs the console to show assigned tracks.
4. **Is the deadline secret?** Default: the deadline is public. Track and instructions are sealed until reveal. Why: teams need the deadline before the tap, and system countdown posts need a time.
5. **Roster size and roles?** Default: 1 to 6 members, exactly one Captain, solo passkey has exactly 1 member, a handle is on at most one roster. Why: prevents one person claiming two teams and keeps the demo rosters small.
6. **How is "physical key" versus "passkey" decided honestly?** SimpleWebAuthn can verify attestation signatures but QuackTrack has no trust roots for key makers. Default: label from the authenticator's signed flags plus the organizer's chosen mode. A "Security key" enrollment must be device bound and not backed up, or it is rejected. Attestation is set to "none" so Chrome shows no extra privacy prompt on stage. Residual risk: a custom software authenticator could pretend to be device bound. Why: the label is honest about what was checked, and the demo has no extra dialog.
7. **What does "fail with the wrong key" look like?** With the team's credential listed as the only allowed credential, the browser itself refuses a different key, so the server never receives an assertion. Default: the page shows the red banner "That was not Team Mallard's key, or the tap was cancelled. Nothing was revealed." and reports a client side failure, logged as `tap.client_failed` and labeled client reported. If someone posts an assertion from a different enrolled credential directly, the server rejects it: "That key is not Team Mallard's key. Nothing was revealed." Why: the visible failure is what the demo needs, and the server check is what security needs.
8. **What if a team taps before a prompt is assigned?** Default: the tap mints a session and the room says no prompt is assigned yet. A later tap reveals it. Why: reveal stays ceremony tier and nothing is lost.
9. **Can a prompt be reassigned?** Default: yes until that team reveals, never after. Why: fixes organizer mistakes without breaking "the team saw this prompt at this time".
10. **Must a team reveal before it submits?** Default: yes. Why: a submission without a revealed prompt makes the console lie about the order of events.
11. **Late submissions?** Default: rejected after the team's assigned prompt deadline. Why: the deadline is the one rule a hackathon needs enforced.
12. **Who is the signer?** Default: the submission is signed by the team credential and attributed to the team only, not to a member. Why: the ceremony ignores the cookie, and the member selection lives in the cookie.
13. **Must the repo be on GitHub?** Default: any https URL is accepted. The owner check runs only for github.com links and shows "Not GitHub" otherwise. Why: never block a real submission over a check the material calls informational.
14. **What can a Judge/Observer do?** Default: watch the projected console and open receipt links. No login. Why: the material names the actor but gives no powers, and receipts are the proof judges need.
15. **Session length?** Default: 8 hours absolute, no sliding. Why: covers the event day, and a stolen cookie can never reach ceremony tier anyway.
16. **What does reset keep?** Default: reset wipes everything except the organizer credential and the organizer's current session. The new log starts with an entry recording the old chain's head hash. Why: the organizer can reset between rehearsals without re-enrolling.
17. **Demo seed handles.** Default: Team Mallard's seed roster is `jasonepage` (Captain) and `quack-builder-demo` (Builder), Team Teal's is `teal-captain-demo` (Captain). The demo repo link must be owned by `jasonepage` so the owner check shows a match. Change the seed in src/routes/org.js if the presenter's handle differs. Why: a green owner check on stage.
18. **When is "deadline approach" for the drama feed?** Default: 10 minutes before each deadline, one post per unsubmitted team. The countdown post is at 30 minutes. Why: two moments, both readable on stage.
19. **How is "never invent event facts" checked?** Default: the model must return JSON (JavaScript Object Notation) with a verbatim quote from the bundle. The server accepts an answer only if the quote is found in the bundle. Otherwise it shows the refusal sentence and logs the question as unanswered. Why: a check the server can run, instead of trusting the model.
20. **Which Gemini model?** Default: the constant `gemini-3.8-flash` in src/ai/gemini.js. Changed in Session 2: on October 25, 2026 Google's deprecations page said 2.5 models are limited to users who used them before and pointed new projects to 3.5 Flash-Lite or 3.8 Flash, and the pricing page listed a free tier for `gemini-3.8-flash`. If it fails, change that one constant to `gemini-3.5-flash-lite`. Why: the env var list is locked, so the model is a code constant.
21. **How long is a challenge valid?** Default: 120 seconds. Why: long enough for a nervous tap, short enough that a captured challenge goes stale quickly.
22. **What time zone are times shown in?** Default: the server sends ISO 8601 (International Organization for Standardization date format) times and each browser shows its own local time. Why: Render runs in UTC (Coordinated Universal Time). For the same reason, server built error sentences never contain a clock time (SDS.md D14).

## 10. Deployment modes

One codebase, two modes. Only environment variables change between them (SRS.md NFR-02), never code.

| | Local mode (default) | Hosted mode (stretch, after submission) |
|---|---|---|
| Start | `git clone` the public repo, `npm install`, `npm start` | Render Starter web service from the public repo, start command `npm start` |
| Address | http://localhost:3000, RP_ID `localhost` | `https://<service>.onrender.com`, RP_ID `<service>.onrender.com` |
| Who taps where | Every team taps in on the host laptop, one team at a time, then clicks Leave room | Teams use their own laptops and phones at the HTTPS address |
| AI | Gemma through local Ollama (BYOM), Gemini with the organizer's own key (BYOK), or the searchable list | Gemini with the organizer's own free tier key, because a Render Starter instance cannot run Gemma |
| Data | In memory on the host laptop; with Gemma nothing leaves the machine | In memory on Render; a restart or redeploy wipes the event |
| Cost | $0 | Render Starter, about $7 a month, cancel after |

Why multi device is hosted only: WebAuthn works only on localhost or a real HTTPS origin, so other laptops cannot use the host's localhost as a valid origin. Team chat and The Quad work in local mode but only on the host laptop; their real use is hosted mode. A key enrolled in one mode must be enrolled again in the other, because credentials are bound to their RP ID.

## 11. Key provisioning and team lifecycle

Key provisioning:
- Default: the organizer buys a reusable pool of FIDO2 keys once. At check-in the organizer checks one out to each team, and the team enrolls it at the desk right after the handover (SRS.md FR-40). Cost is per team, not per person, and keys are reused across events.
- Alternative: a team may use its own key. The organizer checks the team in person, ticks the approval box, and enrolls it with the same ceremony. The fingerprint is logged, and a credential already bound to any team is rejected.
- Tag rule: at checkout the organizer attaches a bright keychain or tag and records its color and the key's pool label on the row. The tag shows only the team name and "Return to the organizer desk", never a credential ID or PIN.
- Return and reset: teams return pool keys at the end. Before the next event the organizer resets each returned key with the maker's tool (for a YubiKey, `ykman fido reset`). QuackTrack's own credentials are not stored on the key (it asks for non-resident credentials), but a team may have set a PIN or saved passkeys for other sites on it, and a reset clears both.
- Records: the console shows which team holds which key while the server runs. The server forgets everything when it stops, so the README key sheet is the record across events. Return tracking on the console is parked (section 8). An unreturned key never blocks a submission.
- A pool key serves one team per event. Its first credential stays excluded, so it cannot be enrolled again in the same event.
- Lost or broken key: the OVERRIDE ceremony (SRS.md FR-41). The organizer taps the organizer credential, the captain taps a replacement key, and the word OVERRIDE shows on the console, room, The Quad, receipt, and log check. A backup key at enrollment is rejected: it doubles the pool cost and gives a team two live identities.

Team lifecycle rules:
- Roster: members join themselves with the team's key tap on /team (FR-42, INV-12); the organizer removes a member at any time (FR-43). After the team submits, members can be removed but nobody can join.
- Late joiner: joins like anyone else, with the team's key tap on /team, until the team submits. Example: octocat arrives at 2pm, borrows Mallard's key, picks Team Mallard on /team, chooses "I'm new to this team", types `octocat`, Builder, and taps.
- Member leaves: the organizer may remove them (FR-43). A receipt always shows the roster the team signed, even if someone is removed later.
- Merge: rejected. Two enrolled teams have two credentials and two prompts, and one team with two identities breaks L3. The teams pick one team to submit; the other stays Not submitted.
- Dissolve: a team that quits stays on the console as Not submitted, then Missed deadline. Enrolled teams cannot be deleted (FR-03), so the console and log never lose a team.
- Solo team: passkey mode with exactly 1 member, or key mode with 1 member.
- Duplicate team names and duplicate handles: rejected (FR-03, FR-04).
- Rename: rejected. In DRAFT, delete and create again. After enrollment the name is inside the signed roster hash.
- Prompt typo: prompts cannot be edited. Before reveal, create a corrected prompt and reassign it. After reveal, the organizer announces the fix out loud.
