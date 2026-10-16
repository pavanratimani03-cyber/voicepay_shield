# Verity — Finance voice verification

A hackathon prototype for the UNCLONE Finance track. Before a bank or finance-team member acts on a payment request made by phone, the app runs two independent checks on the call audio: deepfake detection and enrolled-speaker verification. It fails closed unless both configured APIs return an explicit passing boolean. Passing this check is decision support, not a payment authorization.

## Run it

Requires Node.js 18 or newer. There are no npm dependencies.

1. Copy `.env.example` to `.env`.
2. Add the DetectifAI team API key and the two endpoint URLs supplied by the organizers.
3. Start the app with `npm start` and open `http://localhost:5000`.
4. Enter the caller label and enrolled speaker ID, then record a consented sample or upload an authorized recording.

The API credentials stay on the local server. The browser sends audio to the local `/api/verify` route; the server forwards it to both configured services. No verification result is generated when the APIs are missing or fail.

## API integration notes

The event PDF confirms that DetectifAI will provide deepfake detection and speaker verification APIs, but it does not specify endpoint URLs, authentication, upload fields, response schema, or enrollment flow. Add the provided URLs and credentials to `.env`. The current adapter sends multipart fields `file` and `speaker_id` and uses a bearer token by default. If the official API docs specify different fields or authentication, update `callDetectifAI()` in `server.js` before connecting it.

The adapter currently recognizes explicit boolean response keys:

- Deepfake check: `is_fake`, `is_deepfake`, or `is_synthetic` (`false` means authentic).
- Speaker check: `match`, `is_match`, or `verified` (`true` means the enrolled speaker matches).

Unknown response shapes fail closed and show as a failed check. Adapt `parseDecision()` to the official response schema; do not add mock results for a live demo.

## Demo flow

1. Explain the user: a finance officer receives a phone request to change vendor bank details or approve a transfer.
2. Enter a claimed caller and an enrolled speaker ID.
3. Record a short, consented sample or upload an authorized audio clip.
4. Show both API checks. If either fails, the app advises holding the payment and contacting the requester through a known number. Even if both pass, follow normal payment controls.

## Five-slide judging deck outline

1. **Problem** — Voice cloning makes urgent payment-change calls harder to trust.
2. **Solution** — A verify-before-you-pay gate checks the call before the finance officer acts.
3. **DetectifAI** — Live deepfake detection plus speaker verification, integrated as two checks.
4. **Impact** — Gives finance teams a fast reason to pause suspicious requests and verify through a known channel.
5. **Scale** — Extend from vendor-bank changes to UPI support, treasury approvals, and customer phone banking; retain human payment approval.

## Safety and hackathon fit

- Use only your own voice or recordings made with the speaker's express permission. Do not clone a real person.
- The prototype does not cache or fabricate pass/fail output.
- Audio is sent only when the team runs the check. Configure API retention and consent according to DetectifAI's terms.
- Never put the API key in frontend code or commit `.env`.
- The hackathon rulebook says all project development must happen during the event. Use this as a project plan; make the prototype implementation during the allowed hackathon period.
