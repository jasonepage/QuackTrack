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

## Not built in this version

- Organizer notes and team secrets (SRS.md FR-17 to FR-19, INV-07) were cut by cut line 1 and are not built.

## License

MIT. See LICENSE.
