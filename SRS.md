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
- **Submission:** project name, repo URL (Uniform Resource Locator), commit SHA, description, and the build declaration, all signed by one tap.
- **Commit SHA:** the full 40 hex character commit ID that `git rev-parse HEAD` prints for the submitted repo. SHA means Secure Hash Algorithm. Stored lowercase.
- **Build declaration:** the fixed sentence `We declare that this project was built during this event.` A team ticks a box whose label is this sentence. The exact sentence is part of the signed content.
- **Content hash:** SHA-256 of the canonical submission string, shown as lowercase hex. The short hash is its first 8 hex characters.
- **Receipt:** the public record of a submission with everything needed to re-check its signature.
- **Action log:** the append only list of events, each entry carrying the hash of the entry before it.
- **Commons (The Quad):** the one public chat shared by all enrolled teams. Its on screen title is "The Quad". Code, endpoints, and log actions keep the name `commons`.
- **Context bundle:** the event information text the organizer supplies for the FAQ (frequently asked questions) assistant.
- **Refusal sentence:** exactly `I can't find that in the event information, so I've sent your question to the organizers.`
- **Fail banner:** a full width red bar at the top of the page with one sentence in at least 32px bold white text.
- **BYOK (bring your own key):** the organizer supplies their own Gemini API (application programming interface) key in an environment variable. In this file "BYOK" alone always means that Gemini key. A security key a team brings is called a "team's own key".
- **Key pool:** the reusable FIDO2 security keys the organizer owns. One pool key is checked out to each team at enrollment and returned at the end of the event. Cost is per team, not per person, and the pool is reused across events.
- **Team's own key:** a FIDO2 security key a team brings and the organizer approves in person at enrollment (FR-40). It uses the same Enroll ceremony as a pool key.
- **Key fingerprint:** the first 16 hex characters of the SHA-256 of a credential's public key, shown in groups of 4, for example `3fa2 c9e1 0b7d 44aa`. It names the credential, not the physical key, because attestation is off (SDS.md D1).
- **Override:** the organizer ceremony that replaces a lost or broken team key (FR-41). It is logged as `team.override` and shown with the word OVERRIDE everywhere it appears.
- **Local mode:** the default. A clone runs at http://localhost:3000 on one laptop, and every team taps in on that laptop, one team at a time.
- **Hosted mode:** the same code on Render at an HTTPS origin, set only by environment variables. Teams use their own devices. WebAuthn works only on localhost or a real HTTPS origin, so multi device use exists only in hosted mode.
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
- **US-13:** As an Organizer, I issue a sponsor API key to one team as a sealed secret that only their tap reveals. Parked by cut line 1 (SDS.md section 13).
- **US-14:** As an Organizer, I mute a team that spams the commons and delete one of its posts.
- **US-15:** As a Judge, I open a receipt link and see three green checks that the signature matches the content.
- **US-16:** As a self hosting organizer, I clone the repo, run it on localhost with Gemma through Ollama, and no data leaves my machine.
- **US-17:** As a Team Captain whose key broke, I get a replacement key through an organizer override that everyone can see, so my team can still sign.
- **US-18:** As an Organizer, I check a pool key out to each team at enrollment and record its tag, or approve a team's own key, so I know which key each team holds.

## 4. Functional requirements

All failures return `{"ok": false, "code": "<CODE>", "error": "<sentence>"}` with the stated HTTP status. The page shows `error` in the fail banner. A failure changes no state unless the failure text says so. "Logs X" means one action log entry with action X. Every sentence a person can see comes from the error dictionary in section 4A, and `code` is its code there. If an FR sentence and the dictionary differ, the dictionary wins and the FR must be fixed. In sentences, `{team}` is the team name exactly as stored, for example `Team Mallard`. Server built error sentences never contain a clock time, because the server cannot know the viewer's time zone (SDS.md D14).

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
- Failure: tap cancelled or refused by the browser: banner `The key tap was cancelled. Nothing changed.`

### FR-03 Create and delete a draft team
- Actor: Organizer.
- Preconditions: organizer session.
- Happy path: the organizer enters a team name (1 to 40 characters) and a mode (`key` or `passkey`). The server creates a team in state DRAFT with an empty OPEN roster and logs `team.created`. The organizer can delete a DRAFT team, which logs `team.deleted`. An event holds at most 40 teams. Teams are never renamed: a DRAFT team with a wrong name is deleted and created again, and after enrollment the name is inside the signed roster hash.
- Failure: name already used (case insensitive): 409 `A team named Team Mallard already exists. Pick another name.`
- Failure: 40 teams already exist: 409 `This event already has 40 teams, the most QuackTrack holds.`
- Failure: delete of a non draft team: 409 `Team Mallard is enrolled and cannot be deleted.`

### FR-04 Roster rules
Changed in Session 3: the organizer no longer types rosters. Members join themselves (FR-42), and these rules apply to every join.
- Rules: GitHub handle 1 to 39 characters, letters, digits, single hyphens, no leading or trailing hyphen; display name 1 to 40 characters; role one of Captain, Builder, Designer, Presenter; a handle is on at most one roster in the event (compared lowercase); at most 6 members, at most 1 in passkey mode; at most one Captain. The first member to join a team with no Captain becomes its Captain whatever role they picked.
- Failure: handle does not match the GitHub handle rule: 400 `That is not a valid GitHub handle.`
- Failure: handle on any roster in the event: 409 `octocat is already on Team Teal's roster.`
- Failure: role Captain asked for while the team has a Captain: 409 `Team Mallard already has a Captain.`
- Failure: seventh member, or second member in passkey mode: 409 `Team Mallard's roster is full.`
- Failure: role is not one of the four: 400 `Pick a role: Captain, Builder, Designer, or Presenter.`

### FR-05 Enroll ceremony
- Actor: Team Captain with the Organizer.
- Preconditions: organizer session, team DRAFT, key source fields valid (FR-40). Changed in Session 3: no roster is needed; members join after enrollment (FR-42).
- Happy path: the organizer clicks "Enroll with key". The server computes the roster hash, builds a registration challenge bound to it, and lists every stored credential labeled `Security key` or `Organizer key` as excluded so the browser refuses a key that is already enrolled (SDS.md D6). The captain taps. The server verifies the registration, checks the credential ID is new, labels the credential (FR-06), computes the key fingerprint, sets the roster BOUND with its hash, sets the team ENROLLED, and logs `team.enrolled` with the roster hash, label, key source, tag color, tag label, and key fingerprint.
- Failure: browser reports the key is already registered (InvalidStateError): banner `This key is already enrolled to another team or the organizer. Use a different key.`
- Failure: credential ID already stored for any team or the organizer (checked on the server for every credential type): 409 with the same sentence.
- Failure: tap cancelled: banner `The key tap was cancelled. Nothing was enrolled.`
- Failure: challenge expired or used: 410 `This tap expired. Click Enroll again.`
- Failure: roster changed between options and verify (roster hash differs): 409 `Team Mallard's roster changed during enrollment. Click Enroll again.`

### FR-06 Honest credential label
- Actor: Server.
- Preconditions: a verified registration in FR-05 or FR-01.
- Happy path: the three key checks are: device bound (`credentialDeviceType` is `singleDevice`), not backed up, and the response reports `cross-platform` attachment. In `key` mode the label is `Security key` only if all three pass. In `passkey` mode the browser may offer the laptop's passkey or "use a phone", and the label is `Security key` if all three pass (a solo team that used a physical key), else `Platform passkey (synced)` when backed up, else `Platform passkey`. The attachment value is reported by the client and is not signed, so it can only narrow a label: a credential that fails a signed check is never labeled `Security key`. The organizer watching the tap at the desk is the physical check. The label appears on the console row, team room, and receipt, and never changes. An override (FR-41) gives the new credential its own label.
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
- Happy path: the organizer picks a prompt for a team. The server sets the team's assigned prompt and logs `prompt.assigned` with team ID and prompt ID. Reassigning before reveal replaces it and logs again. Assignment is manual, one team at a time, and every assignment is logged, which is the fairness record. There is no random draw (parked, PRODUCT.md section 8). Prompts cannot be edited: before reveal the organizer creates a corrected prompt and reassigns it.
- Failure: team already REVEALED or SUBMITTED: 409 `Team Mallard already revealed its prompt. It cannot be reassigned.`
- Failure: unknown prompt ID: 404 `That prompt does not exist.`
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`

### FR-09 Team tap in and session minting
- Actor: Team Member holding the key.
- Preconditions: team ENROLLED, REVEALED, or SUBMITTED.
- Happy path: on /team the member picks the team name. The server issues an authentication challenge allowing only that team's credential. The member taps. The server verifies against that credential, updates its counter, revokes any team session already in this browser, mints a new team session, sets the `qt_team` cookie, and logs `tap.ok`. Then FR-10 runs in the same response.
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`
- Failure: unknown team ID: 404 `That team does not exist.`
- Failure: assertion from a credential that is not this team's active credential, including one revoked by an override (FR-41): 401 `That key is not Team Mallard's key. Nothing was revealed.` Logs `tap.failed` with reason `wrong_credential` or `revoked`.
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
- Happy path: when `startAuthentication` or `startRegistration` throws, the page sends the ceremony ID and the error name. The server deletes the pending ceremony and logs `tap.client_failed` with team ID, kind, error name, and `reportedBy: "client"`. The page shows the matching banner. On a team tap, NotAllowedError gives `That was not Team Mallard's key, or the tap was cancelled. Nothing was revealed.`, because the browser reports a wrong key, a cancel, and a timeout with the same error name. On an enroll or override registration, InvalidStateError gives `This key is already enrolled to another team or the organizer. Use a different key.` and NotAllowedError gives that ceremony's cancel sentence (E34 or E75). On a sign tap, any error gives `The submission was not signed. Nothing was submitted.` On an organizer tap, any error gives `The key tap was cancelled. Nothing changed.`
- Failure: unknown or expired ceremony ID: 404 `That tap is no longer open.` The page still shows its banner.

### FR-12 Session expiry, logout, replacement
- Actor: Server, Team Member, Organizer.
- Preconditions: a session exists.
- Happy path: a session is valid for 8 hours from minting. Logout deletes it and clears the cookie. A new team tap in a browser revokes that browser's previous team session. The team room has a `Leave room` button that runs logout and returns to /team. In local mode every team shares the host laptop, so when ORIGIN starts with `http://localhost` the room shows the notice `Shared laptop: click Leave room when you are done.` An override (FR-41) revokes every session of that team.
- Failure: expired session on any read tier call: 401 `Your session ended. Tap your key to come back in.` The server deletes the session.
- Failure: cookie with a bad signature or unknown ID: 401 `Your session ended. Tap your key to come back in.`

### FR-13 Team room read
- Actor: Team Member.
- Preconditions: valid team session.
- Happy path: GET room returns team name, state, credential label, key source, override notice, roster, selected member, deadline, `promptState` (`none` when no prompt is assigned, `sealed` when one is assigned and not revealed, `revealed` after reveal), the revealed prompt (only when `revealed`), submission summary, and FAQ mode. A `sealed` room shows the sealed card with `Tap to reveal`, which runs FR-09 with purpose `enter`, so a team that tapped in before assignment is never stranded. Notes and secrets are parked with FR-17 to FR-19. When the team's key was replaced, the room shows `Your key was replaced by organizer override.` The page polls every 2 seconds.
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
- Happy path: the member posts text (1 to 500 characters). The server stores it in memory with the selected handle, role, and server time, logs `chat.posted` with message ID and team ID (no text), and the team's room shows it within 2 seconds. Only this team's sessions can read it. The server keeps the newest 500 messages per team. Organizers have no screen or endpoint that shows team chat text, but the organizer runs the server that holds it, so the room shows this line above the chat box before anyone types: `Only your team sees this chat in QuackTrack. The organizer runs the server, so never post passwords or keys.` Messages cannot be edited or deleted by anyone, and the chat box says `Messages cannot be edited or deleted.`
- Failure: no member selected: 400 `Pick who is at the keyboard before you chat.`
- Failure: rate limit (more than 1 per second): 429 `Slow down. Wait a second and send again.`

### FR-17 Organizer notes (parked)
**Parked by cut line 1 in Session 2 (SDS.md section 13). Not built in the window. Kept as the design for later.**
- Actor: Organizer.
- Preconditions: organizer session, team ENROLLED or later.
- Happy path: the organizer posts a note (1 to 1000 characters) to one team. It appears on that team's board at read tier. Logs `note.posted` with team ID and note ID.
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`

### FR-18 Team secret issuance (parked)
**Parked by cut line 1 in Session 2 (SDS.md section 13). Not built in the window. Kept as the design for later.**
- Actor: Organizer.
- Preconditions: organizer session, team ENROLLED or later.
- Happy path: the organizer enters a title (1 to 60 characters, shown while sealed) and a body (1 to 2000 characters). The server stores the secret sealed and logs `secret.issued` with team ID and secret ID. The team board shows a sealed card with the title and "Tap to reveal".
- Failure: empty body: 400 `A secret needs a body.`

### FR-19 Team secret reveal (parked)
**Parked by cut line 1 in Session 2 (SDS.md section 13). Not built in the window. Kept as the design for later.**
- Actor: Team Member holding the key.
- Preconditions: team session not required. Secret exists for this team and is sealed.
- Happy path: the member clicks "Tap to reveal" on the sealed card. The server issues a challenge allowing only the team's credential, with purpose `secret` and the secret ID. After a verified tap the server sets `revealedAt`, logs `secret.revealed`, mints a session as in FR-09, and returns the body. Later room reads include the body.
- Failure: secret belongs to another team: 404 `That secret does not exist for Team Mallard.`
- Failure: already revealed: the tap still mints a session and the body is returned. No second reveal is logged.
- Failure: wrong key: as FR-09.

### FR-20 Commons posting
- Actor: Team Member.
- Preconditions: valid team session with a selected member, team not muted.
- Happy path: the member posts text (1 to 280 characters) in The Quad. The server attributes the post from the session: team name, selected handle, role. Logs `commons.posted` with post ID and team ID. All team sessions see it within 2 seconds. Posts cannot be edited, and only the organizer can remove one (FR-23). The post box says `Posts cannot be edited. Only the organizer can remove a post.`
- Failure: muted: 403 `Team Mallard is muted in The Quad by the organizer.`
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
- Happy path: the server adds system posts to The Quad for these log actions only: `team.enrolled` (`Team Mallard enrolled with a Security key.`), `prompt.revealed` (`Team Mallard revealed its prompt.`), `submission.signed` (`Team Mallard signed its submission. Hash 3fa2c9e1.`), and `team.override` (`OVERRIDE: the organizer replaced Team Mallard's key.`). A timer checks deadlines every 15 seconds. Once per distinct deadline time at 30 minutes left it logs `deadline.warning` and posts `30 minutes left until the {deadline} deadline.` Once per unsubmitted team at 10 minutes left it logs `deadline.unsubmitted` and posts `Team Teal has not signed a submission. 10 minutes left.` A post with a time stores it as an ISO field, and the page fills `{deadline}` in the viewer's local time.
- Allowed fields: team name, credential label, short hash, and times. Never allowed: prompt track or instructions, secret titles or bodies, chat or Quad text, FAQ questions, handles, repo URLs, commit SHAs, credential IDs, key fingerprints, tag colors or labels, and failed taps.
- Failure: system posts never fail visibly. A system post that would contain any field outside the allowed list is not posted, and the server prints a warning to the terminal.

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
- Happy path: the member asks a question (1 to 300 characters). `askFAQ({question, bundle})` in src/ai/askFAQ.js is the only AI entry point. It picks the provider from AI_PROVIDER (`gemini` or `gemma`), calls that provider's one function `complete(systemText, question)`, which returns raw text or throws, and returns `{answered, answer, quote, reason, provider}`. Gemini (BYOK) and Gemma (BYOM) are two settings of this one function, not two features. The provider must return JSON with `found`, `answer`, `quote`. The server accepts the answer only if `found` is true and `quote` appears in the bundle (whitespace collapsed, case ignored). The room shows the answer and the quote. Logs `faq.answered` with provider.
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
- Happy path: the FAQ box shows the bundle as a list of sections with a search field that filters as the member types. A question asked in this mode shows the refusal sentence, is logged as unanswered with reason `provider_unavailable`, and filters the list by the question's words. Every other feature works unchanged. Fallback is decided per question: a failed call falls back for that question only, and the next question tries the provider again. The console's AI status shows `not configured`, `ok`, or `unavailable` from the last call.
- Failure: no bundle: the box shows `The organizer has not added event information yet.`

### FR-28 Sign options
- Actor: Team Member holding the key.
- Preconditions: team REVEALED, now before the assigned deadline. Cookie not used for identity.
- Happy path: the member submits team ID, project name (1 to 80), repo URL (https, up to 200), commit SHA (the full 40 hex character ID from `git rev-parse HEAD`, stored lowercase), description (1 to 1000), and `declared: true` from the build declaration box, whose label is the build declaration sentence exactly. The server normalizes, builds the canonical string with the declaration sentence and the team's current roster hash inside it (Session 3), hashes it, adds a fresh nonce, derives the challenge, stores a PENDING submission ceremony, logs `sign.started` with team ID and content hash, and returns options, content hash, and short hash. Several pending sign ceremonies for one team may exist at once. Each expires on its own, so a stranger calling sign options for Mallard cannot cancel Mallard's real ceremony. QuackTrack does not check the commit against GitHub (Gemma mode makes no outbound calls); the receipt links to it so a judge can.
- Failure: SUBMITTED: 409 `Team Mallard already submitted. Submissions cannot be changed.`
- Failure: not revealed: 409 `Reveal your prompt before you submit.`
- Failure: past deadline: 409 `The deadline has passed. Submissions are closed for Team Mallard.`
- Failure: repo URL not https: 400 `The repo link must start with https://.`
- Failure: commit is not 40 hex characters: 400 `The commit must be the full 40 character ID from git rev-parse HEAD.`
- Failure: `declared` is not `true`: 400 `Tick the build declaration before you sign.`

### FR-29 Sign verify and submission creation
- Actor: Team Member holding the key.
- Preconditions: a PENDING submission ceremony for this team.
- Happy path: the client sends the ceremony ID, the same five fields and `declared`, and the assertion. The server deletes the pending record, re-hashes the fields, requires the same content hash, recomputes the challenge, verifies the assertion against the team's credential, updates the counter, re-checks the team is REVEALED and the deadline has not passed, creates the submission SIGNED, sets the team SUBMITTED, logs `submission.signed` with submission ID, content hash, counter, and returns the receipt ID. A team session is minted as in FR-09.
- Failure: content hash differs: 409 `The submission changed after you started signing. Nothing was submitted.`
- Failure: verification fails or wrong credential: 401 `The submission was not signed. Nothing was submitted.` Logs `sign.failed`.
- Failure: a second verify for a team that became SUBMITTED in between: 409 `Team Mallard already submitted. Submissions cannot be changed.`
- Failure: ceremony ID missing, used, or expired: 410 `This signing tap expired. Click Sign submission again.`

### FR-30 Receipt
- Actor: anyone with the link.
- Preconditions: submission SIGNED.
- Happy path: /receipt/<id> shows team name, the roster handles the team signed (FR-28 puts the roster hash in the signed content, so a member removed later still shows), credential label, project name, repo URL, commit SHA (with a `View commit` link built as `<repo URL>/commit/<sha>` for github.com repos), description, the build declaration sentence, canonical string, content hash, nonce, challenge, credential ID, public key, authenticator data, client data JSON, signature, counter, signed time, log sequence number, and entry hash. It shows three checks recomputed on each view: content hash matches, challenge matches the client data, signature valid. A "Download receipt JSON" button saves the same data. If the team's key was replaced before signing, the receipt shows `OVERRIDE: this team's key was replaced by the organizer before signing (log entry 41).` with the real entry number.
- Failure: unknown ID: 404 `There is no receipt with that ID.`
- Failure: a check fails: that check shows red with `This check failed. The receipt does not match its signature.`

### FR-31 Organizer console
- Actor: Organizer.
- Preconditions: organizer session.
- Happy path: one row per team showing name, state, roster handles and roles, credential label, key source and tag (`Pool 01 (yellow)`, `Team's own key`, or `Own passkey`), key fingerprint, an `OVERRIDE lost` or `OVERRIDE broken` tag after an override, assigned track, revealed (red "Not revealed" or green time), submitted (red "Not submitted", green time, or red "Missed deadline" once the team's deadline passes without a submission), short hash, commit (first 7 characters), repo owner check, muted flag. FR-39 sets what must read from across the room. The console also shows prompts, the last 20 log entries written as plain sentences (for example `Team Mallard enrolled with Pool 01 (yellow).`), each with an expand control that shows the raw entry, chain status with the head hash shortened to its first and last 4 characters and an expand control for the full hash, the unanswered questions list, the commons with moderation buttons, the AI provider status, and the line `In-memory event: a restart wipes everything.` It polls every second.
- Failure: no session: 401 `Organizer sign-in required.` with the "Log in with key" button.

### FR-32 Repo owner check
- Actor: Server.
- Preconditions: a signed submission.
- Happy path: for `https://github.com/<owner>/...` or `https://www.github.com/<owner>/...`, the console shows `Owner on roster` in green when the lowercase owner equals a roster handle, otherwise `Owner not on roster` in yellow. Other hosts show `Not GitHub` in grey. The check never blocks or changes a submission.
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
- Rule: the confirm box says `Reset also wipes which team holds which key. Write down the key list first.` because key records live only in memory.

### FR-36 Demo data seed
- Actor: Organizer.
- Preconditions: organizer session, no teams exist.
- Happy path: creates prompt "Duck Pond Sensors" (instructions contain `PINEAPPLE42`) and prompt "Quack Commons" (instructions contain `KIWI19`), each with a deadline 2 hours from now. Creates DRAFT team "Team Mallard" (key mode, key source Pool key, tag `yellow`, pool label `Pool 01`) and DRAFT team "Team Teal" (key mode, Pool key, `blue`, `Pool 02`). Changed with T7: both rosters start empty, because a person joins a roster only with a verified tap of that team's key (INV-12, L1); on stage the presenter joins Team Mallard as `jasonepage` with key A, and that tap also reveals the prompt. The console row prefills its key fields from these values, so Enroll stays one click. Saves a demo bundle with schedule, rules, judging criteria, and FAQ sections. Logs `prompt.created`, `team.created`, and `bundle.updated` for what it creates, then `demo.seeded`.
- Failure: teams already exist: 409 `Demo data needs an empty event. Reset first.`

### FR-37 Origin guard
- Actor: Server.
- Preconditions: any request.
- Happy path: requests whose Host header equals the host of ORIGIN pass. POST requests must have `Content-Type: application/json` and, when an Origin header is present, it must equal ORIGIN.
- Failure: wrong host on a page request: 421 plain page `Open <ORIGIN> instead. Security keys only work on the exact address QuackTrack was set up for.`
- Failure: bad POST origin or content type: 403 `Request blocked: it did not come from this QuackTrack page.`

### FR-38 Ceremony screens
- Actor: Team Member, Organizer, Judge/Observer.
- Preconditions: a ceremony starts or ends on a page.
- Happy path, sign moment: after sign options succeed, the room replaces the form with a locked panel showing the five signed values as read only text, the declaration sentence, and `You are signing hash 3fa2c9e1. Tap your key.` with the short hash in monospace at least 64px. Nothing else on the page moves until the tap ends. The browser's own dialog is the only way to cancel.
- Happy path, receipt moment: on success the panel turns green and shows `Signed. Receipt 3fa2c9e1.` in at least 48px bold, the signed time in local time, and an `Open receipt` link. The receipt page shows its three checks as rows labeled `Content hash matches`, `Challenge matches`, and `Signature valid`, each with `PASS` or `FAIL` in at least 32px.
- Happy path, reveal moment: the sealed card reads `Sealed prompt for Team Mallard. Tap your key to reveal.` After reveal the track shows in at least 40px above the instructions.
- Happy path, enroll moment: while the browser waits, the console row shows `Tap the key now` in at least 32px.
- Projector rule: every text named in this FR reads from 10 feet on a projector at 1280 by 720.
- Failure: the ceremony fails: the panel unlocks, the form keeps the typed values, and the fail banner shows the dictionary sentence.
- Test: run acceptance steps 6 and 7 with the window at 1280 by 720 and read the hash and the `Signed` line from 10 feet.

### FR-39 Console at a glance
- Actor: Organizer, Judge/Observer.
- Preconditions: organizer session.
- Happy path: the console's top strip shows, in at least 40px, `2 of 10 submitted` (submitted count of all teams), and beside it the chain status: a green `Log verified` badge (at least 24px) while the chain verifies, or `Chain BROKEN at entry 7.` in red at the full strip size when it does not (changed in Session 3: the chain is plumbing until it breaks). Each team row starts with its state word (DRAFT, ENROLLED, REVEALED, SUBMITTED) in at least 28px capitals on a colored block: grey for DRAFT, green for SUBMITTED, red for the rest. An override adds a black on orange `OVERRIDE` tag to the row. The 3 second job: from across the room an organizer can tell how many teams have submitted, which teams have not, whether the log is verified, and whether any key was overridden.
- Failure: chain broken: the strip turns red with the sentence. Nothing else changes.
- Test: after acceptance step 8, someone who has not seen the console stands 15 feet from the projection and says within 3 seconds how many teams submitted and whether the log is verified.

### FR-40 Key source at enrollment
- Actor: Organizer at the desk.
- Preconditions: as FR-05.
- Happy path: before clicking "Enroll with key", the organizer sets the key source on the team row. `Pool key` (the default in key mode): the row shows `Attach a bright tag to this key. Write only the team name and "Return to the organizer desk" on the tag. Never write a credential ID or PIN on it.` and the organizer types the tag color and the key's pool label (for example `yellow` and `Pool 03`), each 1 to 20 characters. `Team's own key` (key mode) or `Own passkey` (passkey mode, the only choice there): the organizer ticks `I checked this team in person and approve their own key.` Enrollment then runs FR-05. On success the server stores the key source and tag fields on the team, computes the key fingerprint, logs both in `team.enrolled`, and the console row shows `Pool 03 (yellow)`, `Team's own key`, or `Own passkey`, plus the fingerprint.
- Rule: a pool key is used by one team per event. Its first credential stays in the exclude list, so a second enrollment of the same key fails with E32.
- Rule: returns and resets are physical steps on the README key sheet (NFR-14). The console does not track returns in this build (parked, PRODUCT.md section 8). An unreturned key never blocks a submission.
- Failure: pool key without both tag fields: 400 `Enter the tag color and the key's pool label before enrolling a pool key.`
- Failure: team's own key or own passkey without the approval box: 400 `Tick the box that says you checked this team in person before enrolling their own key.`
- Failure: a credential already bound to any team or the organizer: as FR-05 (E32).
- Test: T4 Done when steps 1 and 2.

### FR-41 Key override (lost or broken key)
- Actor: Organizer, with the Team Captain in person at the desk.
- Preconditions: organizer session, team ENROLLED or REVEALED, the captain is at the desk with a replacement key (a new pool key, or the team's own key with the approval box ticked).
- Happy path:
  1. On the team row the organizer clicks `Replace key`, picks the reason (`lost` or `broken`), fills the key source fields as in FR-40, and types `OVERRIDE`.
  2. The organizer taps the organizer credential. This is a fresh ceremony tier tap, bound to the team, the old credential, and the reason. The organizer cookie alone can never replace a key.
  3. The captain taps the replacement key. Its registration challenge is bound to the team's stored roster hash and the authorized override.
  4. The server verifies both taps, checks the new credential ID is not stored anywhere, applies FR-06 for the team's mode, computes the fingerprint, and logs `team.override` with team, old credential, new credential, label, key source, tag fields, fingerprint, reason, and roster hash.
  5. The old credential becomes REVOKED and stays stored, so its ID stays unique and excluded. Every session of this team is revoked. Every pending tap or sign ceremony for this team is deleted. The roster stays BOUND and unchanged. Team state, assigned prompt, and `revealedAt` are unchanged.
  6. OVERRIDE shows everywhere the override appears: the console log tail shows the entry with a black on orange `OVERRIDE` tag; the team row shows `OVERRIDE lost` or `OVERRIDE broken` beside the label until reset; the team room shows `Your key was replaced by organizer override.`; The Quad gets `OVERRIDE: the organizer replaced Team Mallard's key.` (when T9 is built); a receipt signed after an override shows the OVERRIDE line in FR-30; `scripts/verify-log.js` prints `OVERRIDE at entry 41: Team Mallard.` for each one.
- Failure: confirm text missing or wrong: 400 `Type OVERRIDE to confirm.`
- Failure: team SUBMITTED: 409 `Team Mallard already submitted. A replacement key is not needed.`
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`
- Failure: organizer tap from another credential: 401 `That key is not the organizer's key.` Organizer tap cancelled: banner `The key tap was cancelled. Nothing changed.`
- Failure: replacement tap cancelled: banner `The key tap was cancelled. The old key still belongs to Team Mallard.`
- Failure: replacement key already enrolled anywhere, including the revoked key itself: 409 `This key is already enrolled to another team or the organizer. Use a different key.`
- Failure: key mode with a passkey: 422 as FR-06. Either challenge expired: 410 `This tap expired. Click Replace key again.`
- Rejected alternative: a backup key enrolled at enrollment. Reason: it doubles the key pool cost per team, gives a team two live identities at once, and adds a second key to steal.
- Test: INV-21 and INV-22.

### FR-42 Join a team with its key (Session 3)
- Actor: Team Member holding the team's key.
- Preconditions: team ENROLLED or REVEALED. No session needed.
- Happy path: on /team the member picks the team, chooses `I'm new to this team`, and types GitHub handle, display name, and role. The server applies the FR-04 rules, builds a challenge bound to the team and the new member (SDS.md 6.9), and allows only the team's ACTIVE credential. The member taps. The server verifies the assertion as in FR-09, re-applies the FR-04 rules after the last await, adds the member, recomputes the team's roster hash, logs `tap.ok` with purpose `join` and `roster.joined` with team ID, handle, role, and credential ID, mints the team session with this member selected at the keyboard, and runs FR-10 in the same response. The organizer types nothing. Example: Jason picks Team Mallard, types `jasonepage`, taps key A, and is Mallard's Captain; his teammate then types `quack-builder`, Builder, and taps.
- Failure: FR-04 rule broken: the FR-04 sentence (E22 to E26).
- Failure: team DRAFT: 409 `Team Mallard is not enrolled yet. Enroll at the organizer desk.`
- Failure: team SUBMITTED: 409 `Team Mallard already submitted. New members cannot be added now.`
- Failure: wrong key, cancel, replay, expiry, counter regression: as FR-09 and FR-11 (E41 to E45). Nothing is added.
- Test: INV-12.

### FR-43 Remove a member at any time (Session 3)
- Actor: Organizer.
- Preconditions: organizer session, team in any state.
- Happy path: the organizer clicks `Remove` beside a member. No key tap: removing a person cannot let anyone act as the team. The server removes the member, recomputes the roster hash once the team is enrolled, and logs `roster.removed` with team ID and handle. A receipt signed earlier still shows the roster the team signed (FR-30).
- Failure: handle not on this team's roster: 400 `octocat is not on Team Mallard's roster.`
- Test: remove a member from enrolled Mallard: the row no longer lists them and the log tail shows `roster.removed`.

## 4A. Error dictionary

The only user facing failure sentences in QuackTrack. `{team}` is the stored team name, `{handle}` a roster handle, `{field}` a request field name, `{label}` the field's on screen name (for example `Team name`), `{min}` and `{max}` the limits in NFR-18, `{origin}` the ORIGIN value. Banner means the page shows it without a server response. Never write a sentence that is not here; add a row first.

| No. | Code | HTTP | Exact sentence | Used by |
|---|---|---|---|---|
| E01 | UNKNOWN_FIELD | 400 | `This request has a field QuackTrack does not accept: {field}.` | every endpoint |
| E02 | BAD_LENGTH | 400 | `{label} must be {min} to {max} characters.` | every text field |
| E03 | BAD_TYPE | 400 | `{label} is missing or is not the right kind of value.` | every field |
| E04 | TOO_LARGE | 413 | `That request is too large.` | NFR-10 |
| E05 | BLOCKED | 403 | `Request blocked: it did not come from this QuackTrack page.` | FR-37 |
| E06 | WRONG_HOST | 421 | `Open {origin} instead. Security keys only work on the exact address QuackTrack was set up for.` | FR-37 (plain page) |
| E07 | RATE_TAP | 429 | `Too many key taps from this network. Wait a minute and try again.` | NFR-11 |
| E08 | SERVER | 500 | `Something broke on the server. The organizer can check the terminal.` | FR-33, NFR-05 |
| E09 | SESSION_ENDED | 401 | `Your session ended. Tap your key to come back in.` | FR-12 |
| E10 | NO_TEAM_SESSION | 401 | `Tap your key to open your team room.` | FR-13 |
| E11 | NO_ORG_SESSION | 401 | `Organizer sign-in required.` | FR-31 |
| E12 | SETUP_INVALID | 403 | `This setup link is not valid. Use the link printed in the server terminal.` | FR-01 |
| E13 | SETUP_USED | 403 | `This setup link was already used. Log in on the console instead.` | FR-01 |
| E14 | NO_ORGANIZER | 409 | `No organizer is set up yet. Use the setup link printed in the server terminal.` | FR-02 |
| E15 | NOT_ORG_KEY | 401 | `That key is not the organizer's key.` | FR-02, FR-41 |
| E16 | ORG_TAP_CANCELLED | banner | `The key tap was cancelled. Nothing changed.` | FR-02, FR-41 |
| E17 | TEAM_NAME_TAKEN | 409 | `A team named {team} already exists. Pick another name.` | FR-03 |
| E18 | TEAM_LIMIT | 409 | `This event already has 40 teams, the most QuackTrack holds.` | FR-03 |
| E19 | TEAM_NOT_FOUND | 404 | `That team does not exist.` | any team ID |
| E20 | TEAM_NOT_DELETABLE | 409 | `{team} is enrolled and cannot be deleted.` | FR-03 |
| E21 | NOT_ENROLLED | 409 | `{team} is not enrolled yet. Enroll at the organizer desk.` | FR-08, FR-09, FR-41 |
| E22 | BAD_HANDLE | 400 | `That is not a valid GitHub handle.` | FR-04 |
| E23 | HANDLE_TAKEN | 409 | `{handle} is already on {team}'s roster.` | FR-04 |
| E24 | BAD_ROLE | 400 | `Pick a role: Captain, Builder, Designer, or Presenter.` | FR-04 |
| E25 | SECOND_CAPTAIN | 409 | `{team} already has a Captain.` | FR-04 |
| E26 | ROSTER_FULL | 409 | `{team}'s roster is full.` | FR-04 |
| E27 | ROSTER_LOCKED | 409 | `{team}'s roster is locked.` | FR-04 |
| E28 | (removed in Session 3) | | | enrollment no longer needs a roster |
| E29 | (removed in Session 3) | | | enrollment no longer needs a roster |
| E30 | TAG_MISSING | 400 | `Enter the tag color and the key's pool label before enrolling a pool key.` | FR-40 |
| E31 | OWN_KEY_NOT_APPROVED | 400 | `Tick the box that says you checked this team in person before enrolling their own key.` | FR-40 |
| E32 | KEY_TAKEN | 409 and banner | `This key is already enrolled to another team or the organizer. Use a different key.` | FR-05, FR-41 |
| E33 | NOT_A_KEY | 422 | `This looks like a passkey, not a physical security key. Use the key, or create the team as Solo passkey.` | FR-06 |
| E34 | ENROLL_CANCELLED | banner | `The key tap was cancelled. Nothing was enrolled.` | FR-01, FR-05 |
| E35 | ENROLL_EXPIRED | 410 | `This tap expired. Click Enroll again.` | FR-05 |
| E36 | ROSTER_CHANGED | 409 | `{team}'s roster changed during enrollment. Click Enroll again.` | FR-05 |
| E37 | PROMPT_EMPTY | 400 | `A prompt needs a track and instructions.` | FR-07 |
| E38 | DEADLINE_PAST | 400 | `The deadline must be in the future.` | FR-07 |
| E39 | PROMPT_NOT_FOUND | 404 | `That prompt does not exist.` | FR-08 |
| E40 | ALREADY_REVEALED | 409 | `{team} already revealed its prompt. It cannot be reassigned.` | FR-08 |
| E41 | WRONG_KEY | 401 | `That key is not {team}'s key. Nothing was revealed.` | FR-09 (server check) |
| E42 | WRONG_KEY_OR_CANCEL | banner | `That was not {team}'s key, or the tap was cancelled. Nothing was revealed.` | FR-11 (team tap) |
| E43 | TAP_USED | 410 | `This tap was already used. Tap your key again.` | FR-09 |
| E44 | TAP_EXPIRED | 410 | `This tap expired. Tap your key again.` | FR-09 |
| E45 | COUNTER_BACKWARDS | 401 | `This key's counter went backwards, which can mean a cloned key. Ask the organizer.` | FR-09, FR-29 |
| E46 | TAP_NOT_OPEN | 404 | `That tap is no longer open.` | FR-11 |
| E47 | NOT_ON_ROSTER | 400 | `{handle} is not on {team}'s roster.` | FR-14 |
| E48 | DOWNLOAD_EARLY | 403 | `Reveal your prompt before you download it.` | FR-15 |
| E49 | PICK_MEMBER_CHAT | 400 | `Pick who is at the keyboard before you chat.` | FR-16 |
| E50 | CHAT_SLOW | 429 | `Slow down. Wait a second and send again.` | FR-16 |
| E51 | PICK_MEMBER_POST | 400 | `Pick who is at the keyboard before you post.` | FR-20 |
| E52 | POST_SLOW | 429 | `Slow down. Wait a few seconds and post again.` | FR-20 |
| E53 | MUTED | 403 | `{team} is muted in The Quad by the organizer.` | FR-20 |
| E54 | TRADE_FIELDS | 400 | `A trade offer needs both what you offer and what you want.` | FR-21 |
| E55 | POST_NOT_FOUND | 404 | `That post does not exist.` | FR-23 |
| E56 | NO_BUNDLE | 409 | `The organizer has not added event information yet.` | FR-25, FR-27 |
| E57 | BUNDLE_TOO_LONG | 400 | `The event information is too long. Keep it under 30000 characters.` | FR-24 |
| E58 | FAQ_SLOW | 429 | `One question at a time. Wait a few seconds.` | FR-25 |
| E59 | REVEAL_FIRST | 409 | `Reveal your prompt before you submit.` | FR-28 |
| E60 | DEADLINE_PASSED | 409 | `The deadline has passed. Submissions are closed for {team}.` | FR-28, FR-29 |
| E61 | ALREADY_SUBMITTED | 409 | `{team} already submitted. Submissions cannot be changed.` | FR-28, FR-29 |
| E62 | REPO_NOT_HTTPS | 400 | `The repo link must start with https://.` | FR-28 |
| E63 | BAD_COMMIT | 400 | `The commit must be the full 40 character ID from git rev-parse HEAD.` | FR-28 |
| E64 | NO_DECLARATION | 400 | `Tick the build declaration before you sign.` | FR-28 |
| E65 | CONTENT_CHANGED | 409 | `The submission changed after you started signing. Nothing was submitted.` | FR-29 |
| E66 | NOT_SIGNED | 401 and banner | `The submission was not signed. Nothing was submitted.` | FR-29, FR-11 |
| E67 | SIGN_EXPIRED | 410 | `This signing tap expired. Click Sign submission again.` | FR-29 |
| E68 | NO_RECEIPT | 404 | `There is no receipt with that ID.` | FR-30 |
| E69 | CHECK_FAILED | page | `This check failed. The receipt does not match its signature.` | FR-30 |
| E70 | RESET_CONFIRM | 400 | `Type RESET to confirm.` | FR-35 |
| E71 | SEED_NOT_EMPTY | 409 | `Demo data needs an empty event. Reset first.` | FR-36 |
| E72 | OVERRIDE_CONFIRM | 400 | `Type OVERRIDE to confirm.` | FR-41 |
| E73 | OVERRIDE_NOT_NEEDED | 409 | `{team} already submitted. A replacement key is not needed.` | FR-41 |
| E74 | OVERRIDE_EXPIRED | 410 | `This tap expired. Click Replace key again.` | FR-41 |
| E75 | OVERRIDE_CANCELLED | banner | `The key tap was cancelled. The old key still belongs to {team}.` | FR-41 |
| E76 | SECRET_BODY | 400 | `A secret needs a body.` | FR-18 (parked) |
| E77 | SECRET_NOT_FOUND | 404 | `That secret does not exist for {team}.` | FR-19 (parked) |
| E78 | ADD_AFTER_SUBMIT | 409 | `{team} already submitted. New members cannot be added now.` | FR-42 |

Notices (yellow, not failures): N01 `No prompt is assigned to {team} yet.` (FR-10). N02 the refusal sentence (section 1). N03 `In-memory event: a restart wipes everything.` (FR-31). N04 `Shared laptop: click Leave room when you are done.` (FR-12). N05 `Your key was replaced by organizer override.` (FR-41). Terminal only: `RP_ID must match the host in ORIGIN. QuackTrack stopped.` (NFR-02).

## 5. Non-functional requirements

- **NFR-01 Zero config start.** With no environment variables, `npm install` then `npm start` serves http://localhost:3000, prints the setup link, and the FAQ runs in fallback mode. Test: run in a fresh clone.
- **NFR-02 Configuration.** The server reads only PORT (default 3000), RP_ID (default `localhost`), ORIGIN (default `http://localhost:<PORT>`), SESSION_SECRET (default 32 random bytes per boot, with a terminal notice), AI_PROVIDER (default unset), GEMINI_API_KEY (default unset), OLLAMA_URL (default `http://localhost:11434`), OLLAMA_MODEL (default `gemma4:e2b`). At boot, if the host in ORIGIN is not RP_ID and does not end with a dot plus RP_ID, the server prints `RP_ID must match the host in ORIGIN. QuackTrack stopped.` and exits with code 1, because WebAuthn would refuse every tap. Test: grep `process.env` returns only these 8 names, and `RP_ID=example.com npm start` exits with that line.
- **NFR-03 In-memory only.** No file or database writes at runtime. A restart wipes the event. Test: restart, console shows no teams.
- **NFR-04 Console freshness.** Any state change appears on an open console within 2 seconds. Test: sign with the console visible and time it.
- **NFR-05 Error legibility.** The fail banner text is at least 32px, bold, white on red, one sentence under 120 characters. No response body or page contains a stack trace. Unexpected errors return 500 `Something broke on the server. The organizer can check the terminal.` Test: read a banner from 10 feet.
- **NFR-06 No committed secrets.** .gitignore lists `.env`, `node_modules`, `*.log`. GEMINI_API_KEY never appears in any response, log entry, or page. Test: `git grep -n "AIza"` returns nothing, and with a key set, search the console page source and log export for the key.
- **NFR-07 Open source.** The repo is public with an MIT LICENSE file and a README covering local mode and hosted mode. Test: GitHub shows "MIT license".
- **NFR-08 Browsers.** Current desktop Chrome passes every requirement with a USB (Universal Serial Bus) security key. Safari on macOS passes platform passkey enrollment and taps. Test: run the demo in Chrome.
- **NFR-09 Runtime.** Node 20 or newer, one process, runtime dependencies only express 5.x, @simplewebauthn/server 13.x, @simplewebauthn/browser 13.x. Test: read package.json.
- **NFR-10 Input limits.** JSON bodies over 32 KB are rejected with 413 `That request is too large.` Field limits are as stated in each FR. Test: post a 2000 character chat message, get a 400.
- **NFR-11 Rate limits.** Team tap and sign options: 30 per minute per IP (Internet Protocol) address and team ID together, plus 300 per minute per IP address in total, so teams behind one venue Wi-Fi address in hosted mode do not block each other. Organizer ceremony options and client failure reports: 30 per minute per IP address. Setup options: 5 per minute. Over a ceremony limit returns 429 `Too many key taps from this network. Wait a minute and try again.` Chat, The Quad, and FAQ limits and sentences are in their FRs. Test: send 31 tap options requests for Team Mallard in a minute with curl, the last returns 429, and a request for Team Teal from the same address still succeeds.
- **NFR-12 AI isolation.** A provider call times out after 15 seconds. No request other than FAQ waits on a provider. Test: set AI_PROVIDER=gemma with Ollama stopped, the FAQ shows the list and a tap still works.
- **NFR-13 Hosted mode.** When ORIGIN starts with `https://`, cookies carry the Secure flag and Express trusts one proxy hop. Hosted mode runs AI_PROVIDER=gemini, because a Render Starter instance cannot run Gemma through Ollama. Test: on Render, DevTools shows `Secure` on `qt_team`.
- **NFR-14 Local mode limits stated.** The README says local mode is single device, because WebAuthn needs localhost or a real HTTPS origin, and that credentials enrolled on localhost do not work on the hosted origin. The README also has the key pool sheet: the tag rule, a return check column, and reset with the maker's tool before the next event (for a YubiKey, `ykman fido reset`). Test: read the README.
- **NFR-15 Data stays local in Gemma mode.** With AI_PROVIDER=gemma the server makes no outbound request except to OLLAMA_URL. Test: run with Wi-Fi off and Ollama running, the FAQ answers.
- **NFR-16 Response time.** On the local laptop, every verify endpoint responds within 500 ms after the tap. Test: DevTools network timing.
- **NFR-17 Color is never the only signal.** Every red or green state also has a text label. Test: view the console in grayscale.
- **NFR-18 Hard limits.** These numbers are fixed. Test: for each text field, send one character over its limit and get E02.

| Item | Limit |
|---|---|
| Teams per event | 40 (E18) |
| Members per roster | 1 to 6; solo passkey exactly 1 |
| Team name | 1 to 40 characters, unique ignoring case |
| GitHub handle | 1 to 39 characters, GitHub rule, unique ignoring case across all rosters |
| Display name | 1 to 40 characters |
| Tag color, pool label | 1 to 20 characters each |
| Prompt track / instructions | 1 to 60 / 1 to 4000 characters |
| Project name / repo URL / description | 1 to 80 / https and up to 200 / 1 to 1000 characters |
| Commit SHA | exactly 40 hex characters, stored lowercase |
| Team chat message | 1 to 500 characters; newest 500 kept per team; room returns newest 100 |
| Quad post | 1 to 280 characters; trade offer and want 1 to 80 each; newest 1000 kept; reads return newest 200 |
| FAQ question / accepted answer | 1 to 300 / 1 to 800 characters |
| Context bundle | up to 30000 characters |
| Unanswered questions | newest 500 kept |
| JSON body | 32 KB |
| Challenge | 120 seconds, single use |
| Session | 8 hours absolute, no sliding |
| Polling and timers | console 1 second, room 2 seconds, deadline timer 15 seconds, expiry sweep 60 seconds |
| AI provider call | 15 seconds |
| Action log | append only; never truncated, rotated, or edited during an event; console shows the last 20; reset starts a new chain whose first entry records the old head |

## 6. Invariants

Each human test needs two physical keys (A and B) and takes under 30 seconds once the demo seed is enrolled.

- **INV-01 (L1)** A ceremony tier action is attributed only to the team whose credential produced the verified assertion. Test: logged in as Mallard in this browser, pick Teal on /team and tap key A. Result: refused, Teal row unchanged.
- **INV-02 (L1)** A read tier action is attributed only to the session's team. Test: in Mallard's room console run `fetch('/api/team/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamId:'x',text:'hi'})}).then(r=>r.json()).then(console.log)`. Result: 400 naming `teamId`, nothing posted.
- **INV-03 (L1)** Chat and commons posts carry the session team and a handle on that team's roster. Test: post in the commons from Mallard's room. Result: the post shows Team Mallard and the selected Mallard handle. Selecting `teal-captain-demo` through the API returns 400.
- **INV-04 (L1)** Organizer endpoints reject requests without an organizer session. Test: in a private window, tap key A on /team, then open /console. Result: `Organizer sign-in required.`
- **INV-05 (L1)** A team session can read only its own room. Test: in Mallard's room open `/api/team/room?teamId=x`. Result: 400 naming `teamId`. No endpoint path takes a team ID at read tier.
- **INV-06 (L2)** Before a team's reveal tap, no page or response contains its track or instructions. Test: assign the prompt containing `PINEAPPLE42`, open /team and Mallard's sealed room, press View Source and search DevTools Network for `PINEAPPLE42`. Result: zero hits.
- **INV-07 (L2, parked with FR-19)** Before a secret's reveal tap, no response contains its body. Test: issue a secret with body `MANGO77` to Mallard, open Mallard's room, search DevTools Network. Result: zero hits until key A is tapped on the sealed card.
- **INV-08 (L2)** The action log, the commons, and FAQ answers never contain prompt or secret text. Test: after revealing `PINEAPPLE42`, download the log and search it, read the commons, and ask the FAQ "what is my prompt". Result: zero hits, and the FAQ gives the refusal sentence.
- **INV-09 (L3)** One credential belongs to exactly one identity (one team or the organizer). Test: create draft Team Heron and enroll it with key A. Result: `This key is already enrolled to another team or the organizer. Use a different key.`
- **INV-10 (L3)** A team has at most one submission and it never changes. Test: after Mallard signs, click Sign again. Result: `Team Mallard already submitted at <time>. Submissions cannot be changed.` No endpoint edits a submission.
- **INV-11 (L3)** No submission exists without a verified assertion. Test: click Sign and cancel the key prompt. Result: banner, console row stays red, no receipt.
- **INV-12 (L1)** A person is added to a team's roster only with a verified tap of that team's key (changed in Session 3). Test: on /team pick Mallard, choose `I'm new to this team`, type `octocat`, Builder, and tap key B. Result: the E42 banner and the roster is unchanged. Tap key A: octocat is on Mallard's roster and the log tail shows `roster.joined`.
- **INV-13 (L4)** Every challenge works once. Test: after a successful tap, in DevTools Network right click the verify request, Copy as fetch, paste into the console, run. Result: `This tap was already used. Tap your key again.`
- **INV-14 (L4)** A signature is bound to the content hash. Test: in Mallard's room console run `QT_TEST.tamperSign('changed')` and tap key A. Result: `The submission changed after you started signing. Nothing was submitted.`
- **INV-15 (L4)** Every receipt re-verifies. Test: open Mallard's receipt. Result: three green checks.
- **INV-16 (L5)** Every state change appends one entry whose previous hash equals the prior entry's hash. Test: tap key A on /team, watch the console log tail. Result: a new entry whose `prevHash` equals the prior `entryHash`.
- **INV-17 (L5)** Any edit to the log is detected. Test: download the log, change one letter in entry 3, run `node scripts/verify-log.js quacktrack-log.json`. Result: `Chain BROKEN at entry 3.`
- **INV-18 (L6)** Every failure shows one plain sentence in the fail banner. Test: tap key B for Mallard. Result: the sentence is readable from 10 feet.
- **INV-19 (honest label)** A credential is labeled `Security key` only when device bound, not backed up, and cross platform, and a passkey is never shown as a key. Test: enroll a solo team with Touch ID in passkey mode. Result: console and receipt say `Platform passkey`.
- **INV-20 (L7)** Every build ticket is part of the 60 second demo, a prerequisite of it, or listed in the cut lines. Test: read SDS.md sections 12 and 13.
- **INV-21 (L3)** After an override, the old key never acts for the team again. Test: reset, create Team Heron (key mode, one Captain), enroll it with key A, replace it by override with key B, then on /team pick Heron and tap key A. Result: the E42 banner, and a directly posted key A assertion gets E41 with `tap.failed` reason `revoked`. This test needs a reset, so it takes about 90 seconds.
- **INV-22 (L1)** An override never completes without a fresh organizer tap. Test: click Replace key on Heron, type OVERRIDE, and cancel the organizer tap. Result: E16 banner, Heron's label and fingerprint unchanged, no `team.override` in the log.

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
| ENROLLED | ENROLLED | FR-41 override replaces the credential |
| REVEALED | REVEALED | FR-41 override replaces the credential |
| any | (wiped) | FR-35 reset |

The `muted` flag may toggle in ENROLLED, REVEALED, or SUBMITTED (FR-23). Secret reveals and notes do not change team state.

### Roster
| From | To | Trigger |
|---|---|---|
| (none) | OPEN | FR-03 create team |
| OPEN | OPEN | FR-43 remove member |
| OPEN | (deleted) | FR-03 delete team |
| OPEN | BOUND | FR-05 enroll verify success, records roster hash |
| BOUND | BOUND | FR-42 join with the team's key tap, or FR-43 remove; the roster hash is recomputed |
| any | (wiped) | FR-35 reset |

### Credential
| From | To | Trigger |
|---|---|---|
| (none) | ACTIVE | FR-01, FR-05, or FR-41 registration verify success |
| ACTIVE | REVOKED | FR-41 override of that team's key |
| ACTIVE or REVOKED | (wiped) | FR-35 reset, team credentials only; the organizer credential stays ACTIVE |

A REVOKED credential stays stored so its ID stays unique and excluded. It never verifies a tap. Each team has exactly one ACTIVE credential after enrollment.

### Session
| From | To | Trigger |
|---|---|---|
| (none) | ACTIVE | FR-01, FR-02, FR-09, FR-19, or FR-29 verified tap |
| ACTIVE | ACTIVE | FR-14 select member (team sessions only) |
| ACTIVE | EXPIRED | a request arrives at or after `expiresAt` |
| ACTIVE | REVOKED | FR-12 logout, a new team tap in the same browser, FR-41 override (every session of that team), or FR-35 reset (all except the resetting organizer session) |
| EXPIRED or REVOKED | (deleted) | immediately |

### Submission
| From | To | Trigger |
|---|---|---|
| (none) | PENDING | FR-28 sign options |
| PENDING | SIGNED | FR-29 verify success |
| PENDING | ABANDONED | 120 seconds pass, FR-29 failure, content hash mismatch, FR-11 client failure for that ceremony, or FR-41 override for that team |
| ABANDONED | (deleted) | immediately |
| SIGNED | (wiped) | FR-35 reset only |

## 8. Acceptance criteria (the 60 second demo)

Setup: server on the stage laptop at http://localhost:3000, organizer logged in, demo data loaded, console and /team in two windows of Chrome, keys A and B ready. In the /team window, Team Mallard is picked, `I'm new to this team` is chosen, and `jasonepage` and a display name are typed but not yet submitted (changed with T7: the seed rosters are empty, FR-36).

1. Console shows Team Mallard and Team Teal as DRAFT with empty rosters (FR-36). Pass if both rows say "Not enrolled" and the top strip shows `Log verified`.
2. Enroll Mallard with key A. Pass if the row says ENROLLED and `Security key` within 2 seconds.
3. Enroll Teal with key B. Pass if the row says ENROLLED and `Security key`.
4. Assign "Duck Pond Sensors" to Mallard and "Quack Commons" to Teal. Pass if both rows show their track and red `Not revealed`.
5. On /team click `Join and tap key` and tap key B. Pass if the banner says `That was not Team Mallard's key, or the tap was cancelled. Nothing was revealed.` and the console log tail shows `tap.client_failed`.
6. Click `Join and tap key` again and tap key A. Pass if the room shows the Duck Pond Sensors instructions, the Mallard row lists `jasonepage` as Captain, and it shows a green revealed time while Teal stays red.
7. Fill project name, repo link, commit SHA, and description, tick the build declaration, and sign with key A. Pass if the locked panel showed the short hash before the tap and the room shows `Signed. Receipt <short hash>.` and a receipt link after it.
8. Look at the console. Pass if Mallard is green `SUBMITTED` with the same short hash, Teal is red `Not submitted`, and the top strip shows `Log verified`.
9. The whole sequence takes 60 seconds or less.
