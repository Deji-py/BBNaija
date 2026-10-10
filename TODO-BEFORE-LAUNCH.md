# Before launch

Local play (`pnpm dev`) does not need any of this. The code for LiveKit, Postgres, vote packs, and analytics is already in the repo and stays off until these are set. Do them when you are ready to put a season on the internet.

## Public test (the live URL)

- [ ] Deploy the included `render.yaml` (free testing) or `fly.toml` (paid/always-on). Set `DATABASE_URL` to durable Postgres; Render generates `ADMIN_SECRET` and supplies its public URL automatically.
- [x] Build and serve `apps/client/dist` from the production game-server image, including SPA fallbacks for `/watch`, `/house`, `/apply`, and `/bigbrother`.
- [ ] Run LiveKit where browsers can reach it. Set `LIVEKIT_URL` (`wss://` for anyone outside your machine), `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. Confirm housemates can talk, viewers can only listen, and a Diary Room stays private.
- [ ] Set `PAYSTACK_SECRET_KEY` to a test key (`sk_test_…`). During an open voting window, buy a pack and confirm the extra votes land on that viewer's one vote (return to `/watch/<season>?reference=…`).
- [ ] Run one public test season with friends as housemates and viewers.

## Before anyone is charged or the site is public

- [ ] Create and verify a Brevo sender, then set `BREVO_API_KEY`, `EMAIL_FROM`, and `EMAIL_FROM_NAME` in Render. The production magic-link integration is already wired.
- [ ] Change the placeholder pack price (₦500 for 5 extra votes) in `packages/shared/src/payments.ts`.
- [ ] Check paid-voting and consumer rules for Nigeria (and any other country you accept). Add a terms page Paystack and players can see.
- [ ] Confirm the Paystack webhook (`POST /api/payments/webhook`) against the raw request body. The watch-page return already marks a pack paid; the webhook is the backup if someone closes the tab first.
- [ ] Pick a public name. "Big Brother" and "Big Brother Naija" are trademarks; "Big Brother Ninja" stays an internal codename only (SPEC §12).
- [ ] Safety pass (SPEC M10): reports and an admin review queue, bans, a chat profanity filter, rate limits, Terms of Service, Privacy Policy, House Rules, and the data rules for where you operate (Nigeria Data Protection Act, and GDPR if you take EU users).
