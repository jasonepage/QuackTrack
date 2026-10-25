# QuackTrack

QuackTrack is a hackathon submission system where one FIDO2 (Fast IDentity Online 2) security key is a team's identity. A team sees its assigned prompt only after a verified key tap, and the server logs the moment. A team submits by tapping again, and that tap signs the SHA-256 hash of the exact project name, repo link, commit SHA, description, and build declaration. Organizers watch a live console backed by a hash chained action log.

Stack: plain JavaScript, Node 20 or newer, Express 5, and SimpleWebAuthn 13 (server and browser). Everything lives in memory. A restart wipes the event.

## Local mode (default)

One laptop at http://localhost:3000. No environment variables are needed.

```
git clone <this repo>
cd QuackTrack
npm install
npm start
```

The terminal prints `QuackTrack running at http://localhost:3000`. Open exactly that address. WebAuthn (Web Authentication) treats `localhost` and `127.0.0.1` as different sites, so QuackTrack answers any other address with `Open http://localhost:3000 instead.`

**Local mode is single device.** WebAuthn works only on `localhost` or a real HTTPS origin, so other laptops and phones cannot use the host laptop's `localhost` as a valid origin. Every team taps in on the host laptop, one team at a time, and clicks Leave room when done. Multi device use needs hosted mode.

## Hosted mode (Render)

The same code with only environment variables changed. Teams use their own laptops and phones at the HTTPS address.

1. Create a Render Starter web service from the public repo. Start command: `npm start`.
2. Set these in the Render dashboard (never in a file in the repo):
   - `ORIGIN=https://<service>.onrender.com`
   - `RP_ID=<service>.onrender.com`
   - `SESSION_SECRET` (a long random value)
   - `AI_PROVIDER=gemini` and `GEMINI_API_KEY` (your own free tier key)
3. Open the setup link from the Render log (see below).

When `ORIGIN` starts with `https://`, cookies carry the `Secure` flag and Express trusts one proxy hop. A Render restart or redeploy wipes the event.

**Keys must be enrolled again in each mode.** A credential is bound to its RP ID (relying party identifier). A key enrolled on `localhost` does not work on the Render origin, and the reverse. Enroll the organizer and every team fresh on the hosted origin.

## Environment variables

QuackTrack reads only these 8 variables. Every one has a default, so `npm start` works with none set.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the server listens on. |
| `RP_ID` | `localhost` | WebAuthn relying party ID. Must be the host in `ORIGIN` or a parent domain of it. |
| `ORIGIN` | `http://localhost:<PORT>` | The exact address people open. Requests for any other host are refused. |
| `SESSION_SECRET` | 32 random bytes per boot | Signs session cookies. When unset, the terminal prints `SESSION_SECRET not set: sessions end when the server restarts.` |
| `AI_PROVIDER` | unset | `gemini` or `gemma` for the FAQ assistant. Unset means the FAQ shows the searchable event information list. |
| `GEMINI_API_KEY` | unset | Your own Gemini API key, used only when `AI_PROVIDER=gemini`. |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama address, used only when `AI_PROVIDER=gemma`. |
| `OLLAMA_MODEL` | `gemma4:e2b` | Ollama model name, used only when `AI_PROVIDER=gemma`. |

If the host in `ORIGIN` is not `RP_ID` and does not end with a dot plus `RP_ID`, the server prints `RP_ID must match the host in ORIGIN. QuackTrack stopped.` and exits, because WebAuthn would refuse every tap.

Never write a secret to a file, including a git ignored `.env`. Paste it inline into the one command that needs it, for example:

```
AI_PROVIDER=gemini GEMINI_API_KEY=paste-key-here npm start
```

## Organizer setup link

On every boot with no organizer enrolled, the server prints a one time link to its own terminal:

```
Organizer setup: http://localhost:3000/setup?token=<token>
```

Open it on the host laptop and enroll the organizer credential, usually a passkey with Touch ID, so both physical keys stay free for teams. The link works once. After that, the organizer logs in on the console with a tap. Anyone who can read the server terminal can read the link, so keep the terminal on the host laptop. A restart wipes the event and prints a new link.

## The 60 second demo

Before the clock starts:

1. Run `npm start` on the stage laptop and open http://localhost:3000/console in Chrome. Log in with the organizer passkey.
2. If an earlier run is still in memory, type `RESET` in the Event box and click Reset event. Write down the key list first.
3. Click Load demo data. It makes two prompts, Team Mallard (Pool 01, yellow tag) and Team Teal (Pool 02, blue tag), and the demo event information. The rosters start empty: a person joins a team only by tapping that team's key.
4. In a second window open http://localhost:3000/team, pick Team Mallard, choose "I'm new to this team", and type `jasonepage` and a display name. Do not click Join yet.
5. Keep the project name, repo link (owned by `jasonepage`), full commit SHA from `git rev-parse HEAD`, and description ready to paste.

On the clock (SRS.md section 8):

| Time | Do this | You should see |
|---|---|---|
| 0:00 | Show the console. | "0 of 2 submitted", a green "Log verified" badge, two grey DRAFT rows saying "Not enrolled". |
| 0:05 | Enroll with key on Mallard, tap key A (yellow). | Mallard: ENROLLED, Security key, Pool 01 (yellow). |
| 0:12 | Enroll with key on Teal, tap key B (blue). | Teal: ENROLLED, Security key, Pool 02 (blue). |
| 0:18 | Assign Duck Pond Sensors to Mallard and Quack Commons to Teal. | Both rows show their track and a red "Not revealed". |
| 0:24 | In the team window click Join and tap key, tap key B. | Red banner: "That was not Team Mallard's key, or the tap was cancelled. Nothing was revealed." |
| 0:31 | Click Join and tap key again, tap key A. | The room shows Duck Pond Sensors. Mallard turns green "Revealed", with jasonepage as Captain. |
| 0:37 | Paste the four fields, tick the declaration, click Sign submission. | "You are signing hash ........ Tap your key." in large type. |
| 0:48 | Tap key A. | "Signed. Receipt ........" and an Open receipt link. |
| 0:52 | Point at the console. | "1 of 2 submitted", Mallard green SUBMITTED with the same hash and "Owner on roster", Teal red "Not submitted", "Log verified". |

## Key pool sheet

The server forgets everything when it stops, so this sheet is the record of which key went where. Print it and fill it in at the desk.

Tag rule: attach a bright tag to each key. Write only the team name and "Return to the organizer desk" on the tag. Never write a credential ID or PIN on it.

| Pool label | Tag color | Team | Checked out | Returned | Reset done |
|---|---|---|---|---|---|
| Pool 01 | yellow | | | | |
| Pool 02 | blue | | | | |
| Pool 03 | | | | | |
| Pool 04 | | | | | |
| Pool 05 | | | | | |
| Pool 06 | | | | | |

After the event, reset every returned key with its maker's tool before the next event. For a YubiKey: `ykman fido reset`. This clears any PIN a team set and any passkeys they saved for other sites. QuackTrack does not store its own credentials on the key, and the console does not track returns in this version. An unreturned key never blocks a submission.

## Testing notes

- `QT_TEST.tamperSign('changed')` (SRS.md INV-14) reads the values in the sign form, so fill the form first. Browsers only open a key prompt for a page that has focus, so run it from the developer console with a delay and then click a blank part of the page: `setTimeout(() => QT_TEST.tamperSign('changed'), 3000)`. Without the delay the browser refuses at once, with no prompt, and the room shows "The submission was not signed. Nothing was submitted."
- After a team has submitted, the room shows the receipt link instead of the form. To check "already submitted" (INV-10), send the same request the Sign button sends from that team's room console: `api('/api/sign/options', { body: { teamId: '<team ID from the console log>', projectName: 'x', repoUrl: 'https://github.com/owner/repo', commitSha: 'a'.repeat(40), description: 'x', declared: true } })`.

## Not built in this version

- Organizer notes and team secrets (SRS.md FR-17 to FR-19, INV-07) were cut by cut line 1 and are not built.

## License

MIT. See LICENSE.
