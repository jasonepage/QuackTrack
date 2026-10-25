# PRODUCT.md: what QuackTrack is and how it behaves

Terms: FIDO2 (Fast IDentity Online 2) is the standard behind security keys such as a YubiKey. WebAuthn (Web Authentication) is the browser interface for FIDO2. A "passkey" here means a platform credential stored in a laptop or phone and unlocked with Touch ID or Face ID. A "tap" is one WebAuthn ceremony the server verifies. AI means artificial intelligence. FAQ means frequently asked questions.

## 1. Pitch

QuackTrack is Canvas for hackathons, without the forms. Today submissions run on forms, shared links, and spreadsheets, so anyone with a link can submit as any team, swap a team's submission, or say a prompt never arrived, and nobody can prove what changed. In QuackTrack one physical security key is a team's identity. A team sees its assigned prompt only after a verified tap, and the server logs the moment. A team submits by tapping again, and that tap signs the SHA-256 hash of the exact project name, repo link, and description, so any later change breaks the signature. Organizers watch a live console that flips each team from red to green, backed by a hash chained log that shows any silent edit.

## 2. Actors

| Actor | Can | Cannot |
|---|---|---|
| Organizer | Enroll the first organizer credential with the setup link printed on the server terminal. Log in to the console with a tap. Create prompt assignments. Create draft teams and type rosters with members. Run the Enroll ceremony at the organizer desk. Assign and reassign prompts before reveal. Issue team secrets and notes. Set the FAQ context bundle. Pin, delete, and mute in the commons. Read the log and verify the chain. Reset the event. Load demo data. | Reveal a prompt as a team. Sign or edit a submission. Change a roster after enrollment. Reassign a prompt after reveal. Edit or delete log entries. |
| Team Captain | Bring the team key to the organizer desk. Tap to enroll. Tap to reveal the prompt and team secrets. Tap to sign the submission. Everything a Team Member can do. | Enroll a second key. Submit twice. Edit a submission. See another team's room. |
| Team Member | Register on the roster at enrollment (GitHub handle, display name, role). After the team has a session in a browser, select themselves as the person at the keyboard, read the room, download revealed instructions, chat in the team room, post in the commons, ask the FAQ assistant. Tap the key if they hold it. | Act at ceremony tier without the key. Post as a handle not on their roster. |
| Judge/Observer | Watch the projected organizer console. Open any receipt page by its link and see its three verification checks. | Log in. See prompts, secrets, rosters, team rooms, or the commons. |
| Adversary | Anyone in the room with a second key, DevTools, a stolen cookie, a captured request, or a refresh button. | Reveal another team's prompt, sign for another team, replay a tap, change a signed submission, or edit the log without the chain breaking. |

## 3. Roster model

- A team is people bound to one credential.
- The organizer creates a draft team (name and credential mode: "Security key" or "Solo passkey").
- While the team is a draft and the key is at the desk, each member takes the keyboard and adds one row: GitHub handle, display name, role.
- Roles: Captain, Builder, Designer, Presenter. Each roster has exactly one Captain.
- A roster has 1 to 6 members. Solo passkey mode requires exactly 1 member.
- A GitHub handle can appear on only one roster in the event. Handles are compared lowercase.
- The Enroll tap signs a challenge that includes the SHA-256 hash of the roster, so the roster is bound to the credential. After that the roster is locked.
- There is no GitHub login. The handle is a claim made at enrollment in front of the organizer. The console checks whether the submission repo owner matches a roster handle and shows the result. It never blocks.

## 4. Sessions and action tiers

Cookies remember, keys prove.

- A verified team tap sets an httpOnly cookie named `qt_team` that logs that browser in as that team for 8 hours.
- A verified organizer tap sets a separate cookie named `qt_org`. One browser can hold both, so the console and a team page can run in two windows of the same browser.
- A new team tap in the same browser replaces that browser's team session.
- **Read tier (cookie is enough):** open the team room, re-read or download revealed instructions (downloads are logged), view the roster, select the member at the keyboard, read and post team chat, read and post in the commons, read organizer notes, read secrets already revealed, ask the FAQ assistant. Organizer console actions also run on the organizer cookie.
- **Ceremony tier (fresh tap, cookie ignored for identity):** enroll a key, first reveal of the assigned prompt, first reveal of a team secret, sign a submission, organizer setup, organizer login.

## 5. Team room contents

Only the team's own session can open it. It shows:
1. Team name, credential label ("Security key" or "Platform passkey"), and the deadline.
2. "Who is at the keyboard?" selector listing the roster. Chat and commons posts need a selection.
3. Revealed prompt (track and instructions) with a Download button, or a sealed card with a "Tap to reveal" button.
4. Roster with handles, display names, and roles.
5. Team chat, newest at the bottom, each message showing handle, role, and time.
6. Organizer board: notes (visible on cookie) and team secrets (sealed with "Tap to reveal" until revealed).
7. FAQ assistant box, or the searchable event information list when no AI provider works.
8. Submission form (project name, repo link, description) with the short hash shown before the tap, or the receipt link after signing.
9. The public commons in a side panel.

## 6. The three ceremonies

### Enroll (at the organizer desk, organizer session required)
1. Organizer clicks "New team", types a name, picks a credential mode. Fails if the name is taken: "A team named Mallard already exists. Pick another name."
2. Each member types handle, display name, role and clicks Add. Fails on a bad handle: "That is not a valid GitHub handle." Fails on a duplicate: "octocat is already on Team Teal's roster." Fails on a second Captain: "Team Mallard already has a Captain."
3. Organizer clicks "Enroll with key". The server checks the roster (1 to 6 members, one Captain, solo mode has 1 member) and builds a challenge bound to the roster hash. Fails: "Team Mallard needs exactly one Captain before enrolling."
4. The browser asks for the key. The captain taps. If the key is already enrolled anywhere, the browser refuses and QuackTrack shows "This key is already enrolled to another team or the organizer. Use a different key." If the person cancels: "The key tap was cancelled. Nothing was enrolled."
5. The server verifies, checks the credential is new, labels it, locks the roster, and logs `team.enrolled`. Fails if a "Security key" enrollment produced a synced or platform credential: "This looks like a passkey, not a physical security key. Use the key, or create the team as Solo passkey." Fails if the tap was too slow: "This tap expired. Click Enroll again."
6. Console row shows ENROLLED, the credential label, and a lock on the roster.

### Reveal (team page, any browser at the origin)
1. A member opens /team and picks the team name from the list of enrolled teams.
2. The server issues a fresh challenge that only this team's credential may answer. Fails if the team is a draft: "Team Mallard is not enrolled yet. Enroll at the organizer desk."
3. The member taps. With the wrong key the browser refuses, and QuackTrack shows "That key is not Team Mallard's key. Nothing was revealed." and reports the failed tap to the console log.
4. The server verifies the assertion against this team's credential only, deletes the challenge, updates the counter, and mints a team session. Fails on replay: "This tap was already used. Tap your key again." Fails on counter regression: "This key's counter went backwards, which can mean a cloned key. Ask the organizer."
5. If a prompt is assigned and not yet revealed, the server marks it revealed with the time, logs `prompt.revealed`, and returns the prompt in this response only. If none is assigned, the room opens with "No prompt is assigned to Team Mallard yet."
6. The room shows the prompt. The console row shows "Revealed" with the time.

### Sign (team room)
1. A member fills project name, repo link, description and clicks "Sign submission". Fails if the prompt is not revealed: "Reveal your prompt before you submit." Fails after the deadline: "The deadline passed at 4:45 PM. Submissions are closed for Team Mallard." Fails if already submitted: "Team Mallard already submitted at 3:02 PM. Submissions cannot be changed."
2. The server normalizes and hashes the content, adds a fresh nonce, builds the challenge, and returns the options plus the short hash. The form locks and shows "You are signing hash 3fa2c9e1. Tap your key."
3. The member taps. Wrong key or cancel: "The submission was not signed. Nothing was submitted."
4. The server re-hashes the content sent with the assertion. If it differs from the hash it issued: "The submission changed after you started signing. Nothing was submitted." It verifies the assertion against the team's credential with the recomputed challenge, re-checks the team state, creates the submission, and logs `submission.signed`.
5. The room shows the receipt link. The console row turns green with the time and the short hash.

## 7. The 60 second demo

Setup before the clock starts: server running on the stage laptop at http://localhost:3000. Organizer logged in on the console window. "Load demo data" clicked, which created two prompts (tracks "Duck Pond Sensors" and "Quack Commons"), the FAQ bundle, and two draft teams with rosters: Team Mallard (2 members) and Team Teal (1 member), both in Security key mode. Key A has a yellow sticker, key B a blue sticker. A team window on /team sits beside the console. Submission text is in the clipboard notes.

| Time | Action | Expected screen state |
|---|---|---|
| 0:00 | Show the console. | Two grey rows: Mallard and Teal, DRAFT, rosters listed, "Not enrolled". Chain status green "Chain OK". |
| 0:05 | Click Enroll on Mallard, tap key A. | Mallard row: ENROLLED, "Security key", roster locked. Log tail shows `team.enrolled`. |
| 0:12 | Click Enroll on Teal, tap key B. | Teal row: ENROLLED, "Security key". |
| 0:18 | Assign "Duck Pond Sensors" to Mallard and "Quack Commons" to Teal. | Both rows show the assigned track and a red "Not revealed". |
| 0:24 | In the team window pick Mallard, tap key B. | The browser shows its own "not registered" message. After it closes, a full width red banner: "That key is not Team Mallard's key. Nothing was revealed." Console log tail shows `tap.client_failed` for Mallard. |
| 0:31 | Tap again with key A. | The room opens with the Duck Pond Sensors instructions. Mallard row: "Revealed 0:31" in green. Teal still red. |
| 0:38 | Paste project name, repo link, description. Click Sign. | Form locks: "You are signing hash 3fa2c9e1. Tap your key." (hash differs per content) |
| 0:45 | Tap key A. | Room shows "Signed" and a receipt link. |
| 0:50 | Point at the console. | Mallard row green: SUBMITTED, time, short hash matching the room, repo owner check. Teal row red: not revealed, not submitted. Chain OK. |
| 0:58 | Done. | |

## 8. Out of scope

- GitHub OAuth (Open Authorization) or any password login.
- Roster changes after enrollment, adding a second key, or replacing a lost key.
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

## 9. OPEN QUESTIONS (each with the default chosen)

1. **How does the organizer prove identity?** The material gives the organizer powers but no login. Default: on boot the server prints a one time setup link to its own terminal. The organizer opens it and enrolls an organizer credential, usually a passkey on the host laptop, so both physical keys stay free for teams. Organizer login is a tap. Why: L1 forbids identity from anything but a credential or a session minted from one, and the stage needs both keys for teams.
2. **Where does enrollment happen?** Default: at the organizer desk, in the browser holding the organizer session, for both modes. A solo passkey team in hosted mode uses the browser's "use a phone" option to create the passkey on its own phone. Why: an enrollment link sent to a team would be a bearer code anyone could use to enroll a different key.
3. **Does L2 cover the organizer's browser?** The organizer types the prompts, so they exist there. Default: L2 applies to every response that is not authorized by an organizer session. Why: the alternative is unbuildable, and the demo needs the console to show assigned tracks.
4. **Is the deadline secret?** Default: the deadline is public. Track and instructions are sealed until reveal. Why: teams need the deadline before the tap, and system countdown posts need a time.
5. **Roster size and roles?** Default: 1 to 6 members, exactly one Captain, solo passkey has exactly 1 member, a handle is on at most one roster. Why: prevents one person claiming two teams and keeps the demo rosters small.
6. **How is "physical key" versus "passkey" decided honestly?** SimpleWebAuthn can verify attestation signatures but QuackTrack has no trust roots for key makers. Default: label from the authenticator's signed flags plus the organizer's chosen mode. A "Security key" enrollment must be device bound and not backed up, or it is rejected. Attestation is set to "none" so Chrome shows no extra privacy prompt on stage. Residual risk: a custom software authenticator could pretend to be device bound. Why: the label is honest about what was checked, and the demo has no extra dialog.
7. **What does "fail with the wrong key" look like?** With the team's credential listed as the only allowed credential, the browser itself refuses a different key, so the server never receives an assertion. Default: the page shows the red banner and reports a client side failure, logged as `tap.client_failed` and labeled client reported. If someone posts an assertion from a different enrolled credential directly, the server rejects it: "That key is not Team Mallard's key. Nothing was revealed." Why: the visible failure is what the demo needs, and the server check is what security needs.
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
20. **Which Gemini model?** Default: the constant `gemini-2.5-flash` in src/ai/gemini.js, which is on the free tier as of this writing. If Google retires it, change that one constant. Why: the env var list is locked, so the model is a code constant.
21. **How long is a challenge valid?** Default: 120 seconds. Why: long enough for a nervous tap, short enough that a captured challenge goes stale quickly.
22. **What time zone are times shown in?** Default: the server sends ISO 8601 (International Organization for Standardization date format) times and each browser shows its own local time. Why: Render runs in UTC (Coordinated Universal Time).
