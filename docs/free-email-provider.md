# Free transactional email for BBNaija

_Checked 10 October 2026 against provider-owned pricing and documentation. Free-tier terms can change._

## Recommendation

Use **Brevo Free** for the first deployment.

- It includes **300 email sends per day**, including transactional email. The allowance resets daily and unused sends do not roll over. Brevo describes the plan as free with no time limit, and its transactional-email page says no credit card is required. ([free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [transactional email](https://www.brevo.com/products/transactional-email/))
- It has a REST API and an official TypeScript-first Node.js SDK. A magic-link email can be sent directly from the existing Node server with an API key; no separate worker is required. ([Node.js SDK](https://developers.brevo.com/guides/node-js), [send-email API](https://developers.brevo.com/reference/send-transac-email))
- Brevo explicitly treats account activation, password-reset links, and other user-triggered account messages as transactional email, making it an appropriate category for this app's requested sign-in links. The email should remain strictly functional and contain no promotion. ([transactional-email definition](https://help.brevo.com/hc/en-us/articles/7922954371858-What-is-a-transactional-email), [transactional examples](https://help.brevo.com/hc/en-us/articles/360021196220-What-are-the-differences-between-marketing-transactional-and-automation-emails))
- It can begin with one individually verified sender address: Brevo sends a six-digit code to that address. Authenticating a domain with DNS is still strongly recommended for production deliverability; once a domain is authenticated, its sender addresses are automatically verified. ([sender setup](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [domain authentication](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC))

This is the simplest genuinely free choice if the project does not yet own a custom domain. A Gmail or Yahoo address can be individually verified for an initial test, but those public domains cannot be authenticated and deliverability may be worse. Before a public launch, use a domain the project controls and publish Brevo's DNS records.

The Free plan's 300-send daily cap is a shared account limit. Once it is reached, Brevo queues up to 1,000 additional transactional emails for retry; emails beyond that queue are not delivered. The application should therefore report send failures cleanly and retain its existing per-address request limit.

## Comparison

| Provider | Free transactional allowance | Card on free entry | Sender/domain requirements | Node/API support | Fit here |
|---|---:|---|---|---|---|
| **Brevo** | 300/day; no expiry | No card required | An individual sender can be verified by email; an owned domain with DKIM/DMARC is recommended for production | REST API, SMTP, official TypeScript-first Node SDK | **Best fit.** Highest permanent free daily limit and can start before buying a domain. Free-plan messages may include Brevo branding. |
| **Resend** | 3,000/month and 100/day; 3 domains | Resend's published onboarding principles say it does not ask for a card | Must add and verify a domain the sender owns; then any address at that domain can send | REST API, SMTP, official Node SDK | Excellent developer experience, but lower daily capacity and an owned domain is required for real recipients. |
| **Mailgun** | 100/day; 1 custom domain | No card required | Sandbox only sends to authorized recipients; public sending needs a verified custom domain | REST API, SMTP, official Node SDK | Viable, but adds domain setup immediately and offers one-third of Brevo's daily allowance. |
| **Postmark** | 100/month, no overages; does not expire | No card required for the free start | Verify a sender signature or whole domain; new accounts may need approval before unrestricted sending | REST API, SMTP, official Node library | Good for integration testing, but 100/month is too small for a public magic-link login flow. |
| **Twilio SendGrid** | 100/day for **60 days only** | No card required for trial | Verified sender identity required; domain authentication is recommended for production | REST API, SMTP, official Node library | Not a lasting free solution: new accounts stop sending after the 60-day trial unless upgraded. |

### Resend sources

Resend's current Free plan is $0 for 3,000 transactional emails per month, capped at 100 per day, with three domains. It provides a REST API, SMTP relay and official SDKs. ([pricing](https://resend.com/pricing)) Its Node guide requires an API key and verified domain. ([Node.js guide](https://resend.com/docs/send-with-nodejs), [verified domains](https://resend.com/docs/dashboard/domains/introduction)) Resend's published product philosophy says its onboarding cannot ask for a credit card. ([philosophy](https://www.resend.com/philosophy))

### Mailgun sources

Mailgun's permanent Free plan includes 100 messages per day, one custom sending domain, REST API/SMTP, and two API keys. ([pricing](https://www.mailgun.com/pricing/)) Mailgun separately states that its Free plan needs no credit card. ([Free-plan help](https://help.mailgun.com/hc/en-us/articles/203068914-What-does-the-Free-plan-offer)) The official Node SDK supports Node 18 and later. ([Node SDK](https://documentation.mailgun.com/docs/mailgun/sdk/nodejs_sdk)) Its sandbox requires verified authorized recipients, while public sending uses an authenticated domain with DNS records such as SPF and DKIM. ([quickstart](https://documentation.mailgun.com/docs/mailgun/quickstart), [domain verification](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify))

### Postmark sources

Postmark's Free Developer plan includes 100 emails per month, never expires, and does not allow overages. ([pricing](https://postmarkapp.com/pricing/)) Postmark says the transactional-email free start requires no credit card. ([transactional email](https://postmarkapp.com/lp/postmark-transactional-email)) Sending requires either a verified sender signature or a verified domain. ([getting started](https://postmarkapp.com/support/article/1002-getting-started-with-postmark))

### SendGrid sources

For new accounts, SendGrid is now a timed trial rather than a permanent free Email API tier: 100 messages per day for 60 days, after which sending stops without an upgrade. ([trial policy](https://help.twilio.com/articles/47846436523419), [pricing](https://www.twilio.com/en-us/products/email-api/pricing)) The trial requires a sender identity; single-sender verification is for testing, while domain authentication is recommended before production sending. ([sender identity](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sender-identity))

## Suggested production configuration

The eventual server integration should use Brevo's HTTPS API and these Render environment variables:

```text
BREVO_API_KEY=...
EMAIL_FROM=sign-in@your-domain.example
EMAIL_FROM_NAME=Your Game Name
PUBLIC_URL=https://your-render-service.onrender.com
```

Keep `BREVO_API_KEY` only in Render's secret environment settings. Do not expose it to Vite/client variables or commit it to Git. `PUBLIC_URL` must remain the fixed deployed origin so an attacker cannot influence the host placed in a login link.

For magic links, disable click tracking if the provider/account settings permit it. Link scanners sometimes visit tracked authentication URLs before the user does; this app already makes each token single-use, so a scanner could otherwise consume the token. Send both a small HTML body and a plain-text fallback, show the expiry time, and tell recipients to ignore the email if they did not request it.

## Practical setup order

1. Create a Brevo Free account.
2. Add and verify the initial sender address in **Settings → Senders, Domains & Dedicated IPs → Senders**.
3. Create a restricted API key with transactional-email permission.
4. Add `BREVO_API_KEY`, `EMAIL_FROM`, and `EMAIL_FROM_NAME` to the Render service environment; keep the existing `PUBLIC_URL` set to the exact HTTPS deployment origin.
5. Integrate the send-email call, deploy, and test with Gmail and Outlook addresses while reviewing Brevo's transactional logs.
6. Before inviting the public, connect a custom domain or sending subdomain and publish Brevo's authentication records.

