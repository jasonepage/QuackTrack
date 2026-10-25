# SRS.md: QuackTrack Software Requirements Specification

Every requirement here is testable. Every functional requirement names its actor, preconditions, happy path, and at least one failure with exact behavior. Designs live in SDS.md (Software Design Specification). When this file and SDS.md disagree, this file wins and SDS.md must be fixed.

## 1. Definitions

- **WebAuthn (Web Authentication):** the browser interface for FIDO2 (Fast IDentity Online 2) credentials.
- **Credential:** one WebAuthn public key credential, stored by the server as credential ID, public key, counter, transports, and label.
- **Security key:** a physical, device bound FIDO2 authenticator such as a YubiKey.
- **Platform passkey:** a credential stored in a laptop or phone and unlocked with Touch ID or Face ID.
- **Ceremony:** one options request plus one verify request that completes a WebAuthn registration or authentication. Each ceremony has its own challenge.
- **Challenge:** bytes the authenticator signs. Issued by the server, stored on the server, single use, valid 120 seconds.
- **Tap:** a completed ceremony that the server verified.
- **Assertion:** the signed authentication response from a tap.
- **Session:** a server side record linking a random session ID to a team or to the organizer. The ID travels in an httpOnly cookie.
- **Read tier:** actions allowed with a valid session cookie.
- **Ceremony tier:** actions that need a fresh tap. The cookie is ignored for identity.
- **Prompt assignment (prompt):** track (a short title), instructions, and deadline. Track and instructions are sealed. The deadline is public.
- **Reveal:** the first time a team's tap returns its assigned prompt or a team secret.
- **Roster:** the list of members bound to a team: GitHub handle, display name, role.
- **Submission:** project name, repo URL (Uniform Resource Locator), description, signed by a tap.
- **Content hash:** SHA-256 of the canonical submission string, shown as lowercase hex. The short hash is its first 8 hex characters.
- **Receipt:** the public record of a submission with everything needed to re-check its signature.
- **Action log:** the append only list of events, each entry carrying the hash of the entry before it.
- **Commons:** the one public chat shared by all enrolled teams.
- **Context bundle:** the event information text the organizer supplies for the FAQ (frequently asked questions) assistant.
- **Refusal sentence:** exactly `I can't find that in the event information, so I've sent your question to the organizers.`
- **Fail banner:** a full width red bar at the top of the page with one sentence in at least 32px bold white text.
- **BYOK (bring your own key):** the organizer supplies their own Gemini API (application programming interface) key in an environment variable.
- **BYOM (bring your own model):** the host runs an open weight model through Ollama on their own machine.

## 2. Actors

- **Organizer:** runs the event from the console. Identified by an organizer credential and the `qt_org` session.
- **Team Captain:** the roster member with role Captain. Usually holds the key.
- **Team Member:** any roster member. Acts through the team's `qt_team` session or by holding the key.
- **Judge/Observer:** has no login. Sees the projected console and public receipt pages.
- **Adversary:** anyone trying to act as another team, replay a tap, change a signed submission, read a sealed prompt, or edit the log.

## 3. User stories

- **US-01:** As an Organizer, I create two prompts and assign one to each team, so each team gets a different challenge.
- **US-02:** As a Team Captain, I enroll my team with our roster and our key at the desk, so the key becomes our team identity.
- **US-03:** As a Team Member, I tap our key and see only our prompt, and the organizer sees when we saw it.
- **US-04:** As an Adversary with another team's key, I try to reveal Team Mallard's prompt and I am refused in plain words.
- **US-05:** As a Team Captain, I sign our submission with a tap and get a receipt that proves exactly what we submitted.
- **US-06:** As an Organizer, I watch one console row per team turn green when that team signs.
- **US-07:** As a Team Member, I come back to our room after lunch without tapping, because our browser remembers our session.
- **US-08:** As a Team Member, I chat with my team in our private room under my GitHub handle.
- **US-09:** As a Team Member, I post a trade offer in the commons ("offering: soldering iron, want: USB-C cable").
- **US-10:** As a Team Member, I ask the FAQ assistant when judging starts and get an answer quoted from the event information.
- **US-11:** As an Organizer, I see the questions the FAQ assistant could not answer, so I can announce the answers.
- **US-12:** As a solo hacker, I enroll with Touch ID and the console labels my credential "Platform passkey".
- **US-13:** As an Organizer, I issue a sponsor API key to one team as a sealed secret that only their tap reveals.
- **US-14:** As an Organizer, I mute a team that spams the commons and delete one of its posts.
- **US-15:** As a Judge, I open a receipt link and see three green checks that the signature matches the content.
- **US-16:** As a self hosting organizer, I clone the repo, run it on localhost with Gemma through Ollama, and no data leaves my machine.

## 4. Functional requirements

All failures return `{"ok": false, "code": "<CODE>", "error": "<sentence>"}` with the stated HTTP status. The page shows `error` in the fail banner. A failure changes no state unless the failure text says so. "Logs X" means one action log entry with action X.

### FR-01 Organizer setup
- Actor: Organizer.
- Preconditions: no organizer credential exists. At boot the server printed `Organizer setup: <ORIGIN>/setup?token=<token>` to its terminal.
- Happy path: the organizer opens the link and taps a credential (passkey or key). The server verifies the registration, stores the organizer credential, marks the token used, mints an organizer session, logs `org.enrolled`, and the page redirects to /console.
- Failure: token missing or wrong: 403 `This setup link is not valid. Use the link printed in the server terminal.`
- Failure: token already used or an organizer credential exists: 403 `This setup link was already used. Log in on the console instead.`
- Failure: tap cancelled: banner `The key tap was cancelled. Nothing was enrolled.`

### FR-02 Organizer login
- Actor: Organizer.
- Preconditions: an organizer credential exists.
- Happy path: on /console without a session, the organizer clicks "Log in with key" and taps. The server verifies against the organizer credential only, mints an organizer session, logs `org.login`.
- Failure: no organizer credential yet: 409 `No organizer is set up yet. Use the setup link printed in the server terminal.`
- Failure: assertion from a different credential: 401 `That key is not the organizer's key.`

### FR-03 Create and delete a draft team
- Actor: Organizer.
- Preconditions: organizer session.
- Happy path: the organizer enters a team name (1 to 40 characters) and a mode (`key` or `passkey`). The server creates a team in state DRAFT with an empty OPEN roster and logs `team.created`. The organizer can delete a DRAFT team, which logs `team.deleted`.
- Failure: name already used (case insensitive): 409 `A team named Mallard already exists. Pick another name.`
- Failure: delete of a non draft team: 409 `Team Mallard is enrolled and cannot be deleted.`

### FR-04 Draft roster entry
- Actor: Team Member at the organizer desk, through the organizer session.
- Preconditions: organizer session, team in DRAFT, roster OPEN.
- Happy path: the member enters GitHub handle, display name (1 to 40 characters), and role. The server adds the row and logs `roster.added`. Removing a row logs `roster.removed`.
- Failure: handle does not match the GitHub handle rule (1 to 39 characters, letters, digits, single hyphens, no leading or trailing hyphen): 400 `That is not a valid GitHub handle.`
- Failure: handle on any roster in the event: 409 `octocat is already on Team Teal's roster.`
- Failure: second Captain: 409 `Team Mallard already has a Captain.`
- Failure: seventh member, or second member in passkey mode: 409 `Team Mallard's roster is full.`
- Failure: team not DRAFT: 409 `Team Mallard's roster is locked.`

### FR-05 Enroll ceremony
- Actor: Team Captain with the Organizer.
- Preconditions: organizer session, team DRAFT, roster has 1 to 6 members and exactly one Captain, passkey mode has exactly 1 member.
- Happy path: the organizer clicks "Enroll with key". The server computes the roster hash, builds a registration challenge bound to it, and lists every enrolled Security key credential as excluded so the browser refuses a key that is already enrolled. The captain taps. The server verifies the registration, checks the credential ID is new, labels the credential (FR-06), sets the roster BOUND with its hash, sets the team ENROLLED, and logs `team.enrolled` with the roster hash and label.
- Failure: roster rule broken: 409 `Team Mallard needs exactly one Captain before enrolling.` or `Team Mallard needs at least one member before enrolling.`
- Failure: browser reports the key is already registered (InvalidStateError): banner `This key is already enrolled to another team or the organizer. Use a different key.`
- Failure: credential ID already stored for any team or the organizer (checked on the server for every credential type): 409 with the same sentence.
- Failure: tap cancelled: banner `The key tap was cancelled. Nothing was enrolled.`
- Failure: challenge expired or used: 410 `This tap expired. Click Enroll again.`
- Failure: roster changed between options and verify (roster hash differs): 409 `Team Mallard's roster changed during enrollment. Click Enroll again.`

### FR-06 Honest credential label
- Actor: Server.
- Preconditions: a verified registration in FR-05 or FR-01.
- Happy path: in `key` mode the label is `Security key` only if the credential is device bound (`credentialDeviceType` is `singleDevice`), not backed up, and the response reports `cross-platform` attachment. In `passkey` mode the label is `Platform passkey`, plus `(synced)` when backed up. The label appears on the console row, team room, and receipt, and never changes.
- Failure: `key` mode with a credential that fails any of the three checks: 422 `This looks like a passkey, not a physical security key. Use the key, or create the team as Solo passkey.` Nothing is stored and the challenge is spent.

### FR-07 Create prompt assignment
- Actor: Organizer.
- Preconditions: organizer session.
- Happy path: the organizer enters track (1 to 60 characters), instructions (1 to 4000 characters), and a deadline in the future. The server stores the prompt and logs `prompt.created` with the prompt ID only.
- Failure: deadline in the past: 400 `The deadline must be in the future.`
- Failure: empty track or instructions: 400 `A prompt needs a track and instructions.`

### FR-08 Assign prompt
- Actor: Organizer.
- Preconditions: organizer session, team ENROLLED, prompt exists.
- Happy path: the organizer picks a prompt for a team. The server sets the team's assigned prompt and logs `prompt.assigned` with team ID and prompt ID. Reassigning before reveal replaces it and logs again.
- Failure: team already REVEALED or SUBMITTED: 409 `Team Mallard already revealed its prompt. It cannot be reassigned.`
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`

### FR-09 Team tap in and session minting
- Actor: Team Member holding the key.
- Preconditions: team ENROLLED, REVEALED, or SUBMITTED.
- Happy path: on /team the member picks the team name. The server issues an authentication challenge allowing only that team's credential. The member taps. The server verifies against that credential, updates its counter, revokes any team session already in this browser, mints a new team session, sets the `qt_team` cookie, and logs `tap.ok`. Then FR-10 runs in the same response.
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`
- Failure: assertion from a credential that is not this team's: 401 `That key is not Team Mallard's key. Nothing was revealed.` Logs `tap.failed`.
- Failure: challenge used: 410 `This tap was already used. Tap your key again.`
- Failure: challenge expired: 410 `This tap expired. Tap your key again.`
- Failure: counter regression: 401 `This key's counter went backwards, which can mean a cloned key. Ask the organizer.` Logs `tap.counter_regression`.

### FR-10 Prompt reveal
- Actor: Team Member holding the key.
- Preconditions: FR-09 verified in this request.
- Happy path: if the team is ENROLLED with an assigned prompt, the server sets the team REVEALED with `revealedAt`, logs `prompt.revealed` with team ID and prompt ID, and returns track, instructions, and deadline in this response.
- Happy path: if the team is already REVEALED or SUBMITTED, the response says the prompt is in the room. No new reveal is logged.
- Failure: no prompt assigned: the session is still minted. The response and room show `No prompt is assigned to Team Mallard yet.` in a yellow notice, not the fail banner.

### FR-11 Client reported tap failure
- Actor: Team page or console page.
- Preconditions: an open ceremony ID from an options call.
- Happy path: when `startAuthentication` or `startRegistration` throws, the page sends the ceremony ID and the error name. The server deletes the pending ceremony and logs `tap.client_failed` with team ID, kind, error name, and `reportedBy: "client"`. The page shows the matching banner: wrong key or cancel on a team tap gives `That key is not Team Mallard's key. Nothing was revealed.` when the error name is NotAllowedError.
- Failure: unknown or expired ceremony ID: 404 `That tap is no longer open.` The page still shows its banner.

### FR-12 Session expiry, logout, replacement
- Actor: Server, Team Member, Organizer.
- Preconditions: a session exists.
- Happy path: a session is valid for 8 hours from minting. Logout deletes it and clears the cookie. A new team tap in a browser revokes that browser's previous team session.
- Failure: expired session on any read tier call: 401 `Your session ended. Tap your key to come back in.` The server deletes the session.
- Failure: cookie with a bad signature or unknown ID: 401 `Your session ended. Tap your key to come back in.`

### FR-13 Team room read
- Actor: Team Member.
- Preconditions: valid team session.
- Happy path: GET room returns team name, state, credential label, roster, selected member, deadline, revealed prompt (only if REVEALED or SUBMITTED), notes, secrets (sealed entries show only ID and title), submission summary, and FAQ mode. The page polls every 2 seconds.
- Failure: no session: 401 `Tap your key to open your team room.`
- Failure: any query field present: 400 `This request has a field QuackTrack does not accept: teamId.` (names the field)

### FR-14 Member at the keyboard
- Actor: Team Member.
- Preconditions: valid team session.
- Happy path: the member picks their handle from the roster. The server stores the handle on the session and returns the room.
- Failure: handle not on this team's roster: 400 `octocat is not on Team Mallard's roster.`

### FR-15 Instruction download logging
- Actor: Team Member.
- Preconditions: valid team session, team REVEALED or SUBMITTED.
- Happy path: the server returns the instructions as a text file attachment named `quacktrack-<team>-instructions.txt` and logs `instructions.downloaded` with team ID and selected handle.
- Failure: not revealed: 403 `Reveal your prompt before you download it.`

### FR-16 Team chat
- Actor: Team Member.
- Preconditions: valid team session with a selected member.
- Happy path: the member posts text (1 to 500 characters). The server stores it in memory with the selected handle, role, and server time, logs `chat.posted` with message ID and team ID (no text), and the team's room shows it within 2 seconds. Only this team's sessions can read it. The server keeps the newest 500 messages per team.
- Failure: no member selected: 400 `Pick who is at the keyboard before you chat.`
- Failure: rate limit (more than 1 per second): 429 `Slow down. Wait a second and send again.`

### FR-17 Organizer notes
- Actor: Organizer.
- Preconditions: organizer session, team ENROLLED or later.
- Happy path: the organizer posts a note (1 to 1000 characters) to one team. It appears on that team's board at read tier. Logs `note.posted` with team ID and note ID.
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`

### FR-18 Team secret issuance
- Actor: Organizer.
- Preconditions: organizer session, team ENROLLED or later.
- Happy path: the organizer enters a title (1 to 60 characters, shown while sealed) and a body (1 to 2000 characters). The server stores the secret sealed and logs `secret.issued` with team ID and secret ID. The team board shows a sealed card with the title and "Tap to reveal".
- Failure: empty body: 400 `A secret needs a body.`

### FR-19 Team secret reveal
- Actor: Team Member holding the key.
- Preconditions: team session not required. Secret exists for this team and is sealed.
- Happy path: the member clicks "Tap to reveal" on the sealed card. The server issues a challenge allowing only the team's credential, with purpose `secret` and the secret ID. After a verified tap the server sets `revealedAt`, logs `secret.revealed`, mints a session as in FR-09, and returns the body. Later room reads include the body.
- Failure: secret belongs to another team: 404 `That secret does not exist for Team Mallard.`
- Failure: already revealed: the tap still mints a session and the body is returned. No second reveal is logged.
- Failure: wrong key: as FR-09.

### FR-20 Commons posting
- Actor: Team Member.
- Preconditions: valid team session with a selected member, team not muted.
- Happy path: the member posts text (1 to 280 characters). The server attributes the post from the session: team name, selected handle, role. Logs `commons.posted` with post ID and team ID. All team sessions see it within 2 seconds.
- Failure: muted: 403 `Team Mallard is muted in the commons by the organizer.`
- Failure: no member selected: 400 `Pick who is at the keyboard before you post.`
- Failure: rate limit (more than 1 per 3 seconds per session): 429 `Slow down. Wait a few seconds and post again.`

### FR-21 Trade offers
- Actor: Team Member.
- Preconditions: as FR-20.
- Happy path: a post with kind `trade` carries `offer` and `want` (each 1 to 80 characters) and optional text. It shows a "TRADE OFFER" tag with both fields. The system moves and enforces nothing.
- Failure: missing offer or want: 400 `A trade offer needs both what you offer and what you want.`

### FR-22 System drama feed
- Actor: Server.
- Preconditions: none.
- Happy path: the server adds system posts to the commons for these log actions only: `team.enrolled` (`Team Mallard enrolled with a Security key.`), `prompt.revealed` (`Team Mallard revealed its prompt.`), `submission.signed` (`Team Mallard signed its submission. Hash 3fa2c9e1.`). A timer checks deadlines every 15 seconds and posts once per deadline at 30 minutes left (`30 minutes left until the 4:45 PM deadline.`) and once per unsubmitted team at 10 minutes left (`Team Teal has not signed a submission. 10 minutes left.`). System posts use only team names, times, and short hashes.
- Failure: system posts never fail visibly. A system post that would contain any field other than team name, credential label, time, or short hash is not posted and the server prints a warning to the terminal.

### FR-23 Commons moderation
- Actor: Organizer.
- Preconditions: organizer session.
- Happy path: pin or unpin a post (pinned posts show first), delete a post (it is removed for everyone and replaced with `Post removed by the organizer.`), mute or unmute a team. Each logs `commons.pinned`, `commons.unpinned`, `commons.deleted`, `team.muted`, or `team.unmuted`.
- Failure: unknown post ID: 404 `That post does not exist.`

### FR-24 Context bundle
- Actor: Organizer.
- Preconditions: organizer session.
- Happy path: the organizer pastes the bundle (up to 30000 characters, sections start with a line beginning `# `) and saves. The server stores it and logs `bundle.updated` with its SHA-256.
- Failure: over the limit: 400 `The event information is too long. Keep it under 30000 characters.`

### FR-25 FAQ answering
- Actor: Team Member.
- Preconditions: valid team session with a selected member, a bundle exists.
- Happy path: the member asks a question (1 to 300 characters). `askFAQ` calls the provider set by AI_PROVIDER (`gemini` or `gemma`) with the bundle and question. The provider must return JSON with `found`, `answer`, `quote`. The server accepts the answer only if `found` is true and `quote` appears in the bundle (whitespace collapsed, case ignored). The room shows the answer and the quote. Logs `faq.answered` with provider.
- Failure: no bundle: 409 `The organizer has not added event information yet.`
- Failure: rate limit (more than 1 per 5 seconds per session): 429 `One question at a time. Wait a few seconds.`

### FR-26 FAQ refusal and unanswered log
- Actor: Server.
- Preconditions: FR-25 request.
- Happy path: when `found` is false, the output is not valid JSON, or the quote is not in the bundle, the room shows the refusal sentence exactly. The server adds the question to the unanswered list (team, handle, question, reason, provider, time) and logs `faq.unanswered` with question ID and reason. The console shows the unanswered list newest first.
- Failure: none visible to the team beyond the refusal sentence.

### FR-27 FAQ fallback
- Actor: Server.
- Preconditions: AI_PROVIDER unset or not `gemini` or `gemma`, or `gemini` without GEMINI_API_KEY, or the provider call fails or takes over 15 seconds.
- Happy path: the FAQ box shows the bundle as a list of sections with a search field that filters as the member types. A question asked in this mode shows the refusal sentence, is logged as unanswered with reason `provider_unavailable`, and filters the list by the question's words. Every other feature works unchanged.
- Failure: no bundle: the box shows `The organizer has not added event information yet.`

### FR-28 Sign options
- Actor: Team Member holding the key.
- Preconditions: team REVEALED, now before the assigned deadline. Cookie not used for identity.
- Happy path: the member submits team ID, project name (1 to 80), repo URL (https, up to 200), description (1 to 1000). The server normalizes, builds the canonical string, hashes it, adds a fresh nonce, derives the challenge, stores a PENDING submission ceremony, and returns options, content hash, and short hash. Several pending sign ceremonies for one team may exist at once. Each expires on its own, so a stranger calling sign options for Mallard cannot cancel Mallard's real ceremony.
- Failure: SUBMITTED: 409 `Team Mallard already submitted at 3:02 PM. Submissions cannot be changed.` (time in the browser's local time)
- Failure: not revealed: 409 `Reveal your prompt before you submit.`
- Failure: past deadline: 409 `The deadline passed at 4:45 PM. Submissions are closed for Team Mallard.`
- Failure: repo URL not https: 400 `The repo link must start with https://.`

### FR-29 Sign verify and submission creation
- Actor: Team Member holding the key.
- Preconditions: a PENDING submission ceremony for this team.
- Happy path: the client sends the ceremony ID, the same three fields, and the assertion. The server deletes the pending record, re-hashes the fields, requires the same content hash, recomputes the challenge, verifies the assertion against the team's credential, updates the counter, re-checks the team is REVEALED and the deadline has not passed, creates the submission SIGNED, sets the team SUBMITTED, logs `submission.signed` with submission ID, content hash, counter, and returns the receipt ID. A team session is minted as in FR-09.
- Failure: content hash differs: 409 `The submission changed after you started signing. Nothing was submitted.`
- Failure: verification fails or wrong credential: 401 `The submission was not signed. Nothing was submitted.` Logs `sign.failed`.
- Failure: a second verify for a team that became SUBMITTED in between: 409 `Team Mallard already submitted at 3:02 PM. Submissions cannot be changed.`

### FR-30 Receipt
- Actor: anyone with the link.
- Preconditions: submission SIGNED.
- Happy path: /receipt/<id> shows team name, roster handles, credential label, project name, repo URL, description, canonical string, content hash, nonce, challenge, credential ID, public key, authenticator data, client data JSON, signature, counter, signed time, log sequence number, and entry hash. It shows three checks recomputed on each view: content hash matches, challenge matches the client data, signature valid. A "Download receipt JSON" button saves the same data.
- Failure: unknown ID: 404 `There is no receipt with that ID.`
- Failure: a check fails: that check shows red with `This check failed. The receipt does not match its signature.`

### FR-31 Organizer console
- Actor: Organizer.
- Preconditions: organizer session.
- Happy path: one row per team showing name, state, roster handles and roles, credential label, assigned track, revealed (red "Not revealed" or green time), submitted (red "Not submitted" or green time), short hash, repo owner check, muted flag. The console also shows prompts, the last 20 log entries, chain status with head hash, the unanswered questions list, the commons with moderation buttons, the AI provider status, and the line `In-memory event: a restart wipes everything.` It polls every second.
- Failure: no session: 401 `Organizer sign-in required.` with the "Log in with key" button.

### FR-32 Repo owner check
- Actor: Server.
- Preconditions: a signed submission.
- Happy path: for `https://github.com/<owner>/...`, the console shows `Owner on roster` in green when the lowercase owner equals a roster handle, otherwise `Owner not on roster` in yellow. Other hosts show `Not GitHub` in grey. The check never blocks or changes a submission.
- Failure: unparseable URL path: shows `Not GitHub`.

### FR-33 Action log append
- Actor: Server.
- Preconditions: any state change listed in SDS.md section 8.
- Happy path: the server appends one entry with sequence number, time, actor, action, data, previous hash, and entry hash. Data holds IDs, hashes, handles, team names, labels, counts, and times only.
- Failure: if appending throws, the request fails with 500 `Something broke on the server. The organizer can check the terminal.` and the state change is not kept. Every route appends the log entry before it writes the state change, and writes nothing if the append throws.

### FR-34 Log export and chain verification
- Actor: Organizer, any human with the file.
- Preconditions: organizer session for export.
- Happy path: the console has "Download log" which saves `quacktrack-log.json`. `node scripts/verify-log.js quacktrack-log.json` prints `Chain OK: <n> entries. Head <hash>.` The console shows the same status computed on the server.
- Failure: a changed, removed, or reordered entry: the script prints `Chain BROKEN at entry <seq>.` and exits with code 1. The console chain status turns red with the same sentence.

### FR-35 Reset event
- Actor: Organizer.
- Preconditions: organizer session, the organizer types `RESET` in the confirm box.
- Happy path: the server wipes teams, credentials except the organizer's, rosters, prompts, sessions except the current organizer session, chats, commons, secrets, notes, submissions, unanswered questions, bundle, and pending ceremonies. It starts a new log whose first entry `event.reset` records the previous head hash.
- Failure: confirm text missing or wrong: 400 `Type RESET to confirm.`

### FR-36 Demo data seed
- Actor: Organizer.
- Preconditions: organizer session, no teams exist.
- Happy path: creates prompt "Duck Pond Sensors" and prompt "Quack Commons", each with instructions and a deadline 2 hours from now. Creates DRAFT team "Team Mallard" (key mode) with `jasonepage` Captain and `quack-builder-demo` Builder, and DRAFT team "Team Teal" (key mode) with `teal-captain-demo` Captain. Saves a demo bundle with schedule, rules, judging criteria, and FAQ sections. Logs `demo.seeded`.
- Failure: teams already exist: 409 `Demo data needs an empty event. Reset first.`

### FR-37 Origin guard
- Actor: Server.
- Preconditions: any request.
- Happy path: requests whose Host header equals the host of ORIGIN pass. POST requests must have `Content-Type: application/json` and, when an Origin header is present, it must equal ORIGIN.
- Failure: wrong host on a page request: 421 plain page `Open <ORIGIN> instead. Security keys only work on the exact address QuackTrack was set up for.`
- Failure: bad POST origin or content type: 403 `Request blocked: it did not come from this QuackTrack page.`

## 5. Non-functional requirements

- **NFR-01 Zero config start.** With no environment variables, `npm install` then `npm start` serves http://localhost:3000, prints the setup link, and the FAQ runs in fallback mode. Test: run in a fresh clone.
- **NFR-02 Configuration.** The server reads only PORT (default 3000), RP_ID (default `localhost`), ORIGIN (default `http://localhost:<PORT>`), SESSION_SECRET (default 32 random bytes per boot, with a terminal notice), AI_PROVIDER (default unset), GEMINI_API_KEY (default unset), OLLAMA_URL (default `http://localhost:11434`), OLLAMA_MODEL (default `gemma4:e2b`). Test: grep `process.env` returns only these 8 names.
- **NFR-03 In-memory only.** No file or database writes at runtime. A restart wipes the event. Test: restart, console shows no teams.
- **NFR-04 Console freshness.** Any state change appears on an open console within 2 seconds. Test: sign with the console visible and time it.
- **NFR-05 Error legibility.** The fail banner text is at least 32px, bold, white on red, one sentence under 120 characters. No response body or page contains a stack trace. Unexpected errors return 500 `Something broke on the server. The organizer can check the terminal.` Test: read a banner from 10 feet.
- **NFR-06 No committed secrets.** .gitignore lists `.env`, `node_modules`, `*.log`. GEMINI_API_KEY never appears in any response, log entry, or page. Test: `git grep -n "AIza"` returns nothing, and with a key set, search the console page source and log export for the key.
- **NFR-07 Open source.** The repo is public with an MIT LICENSE file and a README covering local mode and hosted mode. Test: GitHub shows "MIT license".
- **NFR-08 Browsers.** Current desktop Chrome passes every requirement with a USB (Universal Serial Bus) security key. Safari on macOS passes platform passkey enrollment and taps. Test: run the demo in Chrome.
- **NFR-09 Runtime.** Node 20 or newer, one process, runtime dependencies only express 5.x, @simplewebauthn/server 13.x, @simplewebauthn/browser 13.x. Test: read package.json.
- **NFR-10 Input limits.** JSON bodies over 32 KB are rejected with 413 `That request is too large.` Field limits are as stated in each FR. Test: post a 2000 character chat message, get a 400.
- **NFR-11 Rate limits.** Ceremony options and client failure reports: 30 per minute per IP (Internet Protocol) address. Chat, commons, FAQ: as stated in their FRs. Over the limit returns 429 with a plain sentence. Test: send 31 tap options requests in a minute with curl, the last returns 429.
- **NFR-12 AI isolation.** A provider call times out after 15 seconds. No request other than FAQ waits on a provider. Test: set AI_PROVIDER=gemma with Ollama stopped, the FAQ shows the list and a tap still works.
- **NFR-13 Hosted mode.** When ORIGIN starts with `https://`, cookies carry the Secure flag and Express trusts one proxy hop. Test: on Render, DevTools shows `Secure` on `qt_team`.
- **NFR-14 Local mode limits stated.** The README says local mode is single device, because WebAuthn needs localhost or a real HTTPS origin, and that credentials enrolled on localhost do not work on the hosted origin. Test: read the README.
- **NFR-15 Data stays local in Gemma mode.** With AI_PROVIDER=gemma the server makes no outbound request except to OLLAMA_URL. Test: run with Wi-Fi off and Ollama running, the FAQ answers.
- **NFR-16 Response time.** On the local laptop, every verify endpoint responds within 500 ms after the tap. Test: DevTools network timing.
- **NFR-17 Color is never the only signal.** Every red or green state also has a text label. Test: view the console in grayscale.

## 6. Invariants

Each human test needs two physical keys (A and B) and takes under 30 seconds once the demo seed is enrolled.

- **INV-01 (L1)** A ceremony tier action is attributed only to the team whose credential produced the verified assertion. Test: logged in as Mallard in this browser, pick Teal on /team and tap key A. Result: refused, Teal row unchanged.
- **INV-02 (L1)** A read tier action is attributed only to the session's team. Test: in Mallard's room console run `fetch('/api/team/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamId:'x',text:'hi'})}).then(r=>r.json()).then(console.log)`. Result: 400 naming `teamId`, nothing posted.
- **INV-03 (L1)** Chat and commons posts carry the session team and a handle on that team's roster. Test: post in the commons from Mallard's room. Result: the post shows Team Mallard and the selected Mallard handle. Selecting `teal-captain-demo` through the API returns 400.
- **INV-04 (L1)** Organizer endpoints reject requests without an organizer session. Test: in a private window, tap key A on /team, then open /console. Result: `Organizer sign-in required.`
- **INV-05 (L1)** A team session can read only its own room. Test: in Mallard's room open `/api/team/room?teamId=x`. Result: 400 naming `teamId`. No endpoint path takes a team ID at read tier.
- **INV-06 (L2)** Before a team's reveal tap, no page or response contains its track or instructions. Test: assign the prompt containing `PINEAPPLE42`, open /team and Mallard's sealed room, press View Source and search DevTools Network for `PINEAPPLE42`. Result: zero hits.
- **INV-07 (L2)** Before a secret's reveal tap, no response contains its body. Test: issue a secret with body `MANGO77` to Mallard, open Mallard's room, search DevTools Network. Result: zero hits until key A is tapped on the sealed card.
- **INV-08 (L2)** The action log, the commons, and FAQ answers never contain prompt or secret text. Test: after revealing `PINEAPPLE42`, download the log and search it, read the commons, and ask the FAQ "what is my prompt". Result: zero hits, and the FAQ gives the refusal sentence.
- **INV-09 (L3)** One credential belongs to exactly one identity (one team or the organizer). Test: create draft Team Heron and enroll it with key A. Result: `This key is already enrolled to another team or the organizer. Use a different key.`
- **INV-10 (L3)** A team has at most one submission and it never changes. Test: after Mallard signs, click Sign again. Result: `Team Mallard already submitted at <time>. Submissions cannot be changed.` No endpoint edits a submission.
- **INV-11 (L3)** No submission exists without a verified assertion. Test: click Sign and cancel the key prompt. Result: banner, console row stays red, no receipt.
- **INV-12 (L3)** A roster never changes after enrollment. Test: on the console try to add a member to enrolled Mallard. Result: `Team Mallard's roster is locked.`
- **INV-13 (L4)** Every challenge works once. Test: after a successful tap, in DevTools Network right click the verify request, Copy as fetch, paste into the console, run. Result: `This tap was already used. Tap your key again.`
- **INV-14 (L4)** A signature is bound to the content hash. Test: in Mallard's room console run `QT_TEST.tamperSign('changed')` and tap key A. Result: `The submission changed after you started signing. Nothing was submitted.`
- **INV-15 (L4)** Every receipt re-verifies. Test: open Mallard's receipt. Result: three green checks.
- **INV-16 (L5)** Every state change appends one entry whose previous hash equals the prior entry's hash. Test: tap key A on /team, watch the console log tail. Result: a new entry whose `prevHash` equals the prior `entryHash`.
- **INV-17 (L5)** Any edit to the log is detected. Test: download the log, change one letter in entry 3, run `node scripts/verify-log.js quacktrack-log.json`. Result: `Chain BROKEN at entry 3.`
- **INV-18 (L6)** Every failure shows one plain sentence in the fail banner. Test: tap key B for Mallard. Result: the sentence is readable from 10 feet.
- **INV-19 (honest label)** A credential is labeled `Security key` only when device bound, not backed up, and cross platform, and a passkey is never shown as a key. Test: enroll a solo team with Touch ID in passkey mode. Result: console and receipt say `Platform passkey`.
- **INV-20 (L7)** Every build ticket is part of the 60 second demo, a prerequisite of it, or listed in the cut lines. Test: read SDS.md sections 12 and 13.

## 7. State machines

Any transition not listed here is forbidden. The server checks the transition right before writing it.

### Team
| From | To | Trigger |
|---|---|---|
| (none) | DRAFT | FR-03 create |
| DRAFT | (deleted) | FR-03 delete |
| DRAFT | ENROLLED | FR-05 enroll verify success |
| ENROLLED | ENROLLED | FR-08 assign or reassign prompt |
| ENROLLED | REVEALED | FR-10 tap with an assigned prompt |
| REVEALED | SUBMITTED | FR-29 sign verify success before deadline |
| any | (wiped) | FR-35 reset |

The `muted` flag may toggle in ENROLLED, REVEALED, or SUBMITTED (FR-23). Secret reveals and notes do not change team state.

### Roster
| From | To | Trigger |
|---|---|---|
| (none) | OPEN | FR-03 create team |
| OPEN | OPEN | FR-04 add or remove member |
| OPEN | (deleted) | FR-03 delete team |
| OPEN | BOUND | FR-05 enroll verify success, records roster hash |
| any | (wiped) | FR-35 reset |

### Session
| From | To | Trigger |
|---|---|---|
| (none) | ACTIVE | FR-01, FR-02, FR-09, FR-19, or FR-29 verified tap |
| ACTIVE | ACTIVE | FR-14 select member (team sessions only) |
| ACTIVE | EXPIRED | a request arrives at or after `expiresAt` |
| ACTIVE | REVOKED | FR-12 logout, a new team tap in the same browser, or FR-35 reset (all except the resetting organizer session) |
| EXPIRED or REVOKED | (deleted) | immediately |

### Submission
| From | To | Trigger |
|---|---|---|
| (none) | PENDING | FR-28 sign options |
| PENDING | SIGNED | FR-29 verify success |
| PENDING | ABANDONED | 120 seconds pass, FR-29 failure, content hash mismatch, or FR-11 client failure for that ceremony |
| ABANDONED | (deleted) | immediately |
| SIGNED | (wiped) | FR-35 reset only |

## 8. Acceptance criteria (the 60 second demo)

Setup: server on the stage laptop at http://localhost:3000, organizer logged in, demo data loaded, console and /team in two windows of Chrome, keys A and B ready.

1. Console shows Team Mallard and Team Teal as DRAFT with rosters. Pass if both rows say "Not enrolled" and chain status says `Chain OK`.
2. Enroll Mallard with key A. Pass if the row says ENROLLED and `Security key` within 2 seconds.
3. Enroll Teal with key B. Pass if the row says ENROLLED and `Security key`.
4. Assign "Duck Pond Sensors" to Mallard and "Quack Commons" to Teal. Pass if both rows show their track and red `Not revealed`.
5. On /team pick Mallard and tap key B. Pass if the banner says `That key is not Team Mallard's key. Nothing was revealed.` and the console log tail shows `tap.client_failed`.
6. Tap key A. Pass if the room shows the Duck Pond Sensors instructions and the Mallard row shows a green revealed time while Teal stays red.
7. Fill and sign the submission with key A. Pass if the form showed the short hash before the tap and the room shows a receipt link after it.
8. Look at the console. Pass if Mallard is green `SUBMITTED` with the same short hash, Teal is red `Not submitted`, and chain status says `Chain OK`.
9. The whole sequence takes 60 seconds or less.
