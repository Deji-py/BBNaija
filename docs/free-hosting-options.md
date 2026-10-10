# Free hosting options for BBNaija

_Checked 10 October 2026 against provider-owned documentation. Free-tier terms can change._

## Recommendation

For a small public test, use:

1. **One Render Free Web Service** for both the built Vite client and the Node/Colyseus server. Keeping them on one HTTPS origin matches the current client/API design and avoids introducing cross-origin authentication and WebSocket configuration.
2. **Neon Free Postgres** through the existing `DATABASE_URL` configuration.
3. **LiveKit Cloud Build** only when reliable voice or more than the peer-to-peer viewer allowance is needed. The game's existing mesh voice remains the zero-account fallback for a very small test.

This combination has no required monthly hosting fee, but it is a demo setup, not a dependable production service. The main compromise is Render's cold start: after 15 minutes without inbound HTTP traffic or WebSocket messages, the service sleeps and the next connection can take about one minute to wake it. Active WebSocket messages now prevent that idle shutdown. Render allows 750 free instance-hours per workspace per month and supports public WebSockets without a fixed connection-duration limit, although restarts and deploys can still interrupt them. ([Render free services](https://render.com/docs/free), [Render WebSockets](https://render.com/docs/websocket), [2026 WebSocket idle-policy change](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages))

The repository now produces this layout: its `Dockerfile` builds the Vite client and the production Colyseus process serves that output on the same origin. API, matchmaking, and WebSocket traffic use that origin directly, while browser routes fall back to `index.html`. The included `render.yaml` defines the free web service and prompts for an external PostgreSQL `DATABASE_URL`.

## Provider comparison

| Option | WebSockets | Relevant free allowance and limits | Fit for this game |
|---|---|---|---|
| **Render** | Yes. No fixed WebSocket duration; clients should reconnect after restarts. Existing inbound WebSocket messages count as activity. | One free service can use the workspace's 750 hours/month. Sleeps after 15 idle minutes; wake is about one minute. Filesystem is ephemeral. Free Render Postgres is only 1 GB and expires after 30 days. | **Simplest public-test host.** Put client and server in the same service, and use an external durable Postgres database. |
| **Koyeb** | Yes; Web Services explicitly support WebSockets. A held connection prevents normal idle scale-down. | One free instance: 0.1 vCPU, 512 MB RAM, 2 GB SSD, Frankfurt or Washington only, no persistent volume. It sleeps after one hour idle; a deep-sleep cold start is usually 1–5 seconds. Koyeb warns that a WebSocket used to wake a sleeping service may live only a few minutes. Starter requires a valid payment method. ([instances](https://www.koyeb.com/docs/reference/instances), [services](https://www.koyeb.com/docs/reference/services), [scale to zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero), [plans](https://www.koyeb.com/docs/reference/organizations)) | Possible, but 0.1 vCPU is tight for an authoritative 20 Hz game server and the wake-WebSocket caveat makes it less predictable than Render. Its free database has only five active compute hours/month, so use Neon instead. ([database limits](https://www.koyeb.com/docs/databases)) |
| **Google Cloud Run** | Yes, but every connection is an HTTP request with a maximum 60-minute timeout (five minutes by default), so reconnect support is mandatory. An open socket keeps an instance active and billable. | Request-based free tier includes 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests/month; outbound internet transfer has only 1 GiB/month free in North America. A billing account is required and excess usage can cost money. ([WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets), [pricing](https://cloud.google.com/run/pricing), [Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features)) | Technically sound, but not the safest zero-cost choice for long game sessions: persistent sockets consume compute and are forcibly recycled at 60 minutes. |
| **Oracle Cloud Always Free VM** | Yes. It is a normal VM, so there is no platform WebSocket request timeout. | Up to two AMD micro VMs, or an Arm A1 pool totaling 1,500 OCPU-hours and 9,000 GB-hours/month (equivalent to 2 OCPUs/12 GB), plus 200 GB block storage and 10 TB/month outbound. Capacity can be unavailable, and Oracle may reclaim instances deemed idle over a seven-day window. ([Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Free Tier FAQ](https://www.oracle.com/cloud/free/faq/)) | **Best always-on value, highest setup burden.** A single VM can run the app, reverse proxy, Postgres and even self-hosted LiveKit, but the owner must patch Linux, configure TLS/firewalls/backups and monitor it. |

## Free database choices

**Neon is the better fit for this repository.** Its current Free plan gives each project 1 GB of Postgres storage, 100 CU-hours/month (about 400 active hours at 0.25 CU), autoscaling up to 2 CU, 10 branches and a six-hour restore window. Compute suspends while idle, so the server should tolerate database reconnection after resume. ([Neon Free plan update](https://neon.com/blog/neon-free-plan-1-gb-per-project), [compute endpoints](https://neon.com/docs/manage/endpoints/))

**Supabase is a workable alternative.** Free includes two active projects, 500 MB database storage per project, 5 GB egress, 1 GB file storage, 2 million Realtime messages and 200 peak Realtime connections. A free project pauses after one week of inactivity; paused projects can be restored for 90 days. The game does not need Supabase Auth or Realtime because it already implements those concerns, so its extra features do not simplify this deployment. ([Supabase pricing](https://supabase.com/pricing), [billing quotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [paused-project retention](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days))

Do not use Render's free Postgres for anything expected to survive a test campaign: it expires after 30 days. Do not use the container filesystem or SQLite on Render/Koyeb because free container storage is ephemeral.

## Voice

LiveKit Cloud's **Build** plan is $0/month with no card required. Its free allowances are hard caps rather than surprise overage charges: 100 simultaneous participants, 5,000 WebRTC participant-minutes/month and 50 GB downstream transfer/month, shared across the user's free projects. New requests fail after the allowance is exhausted, and allowances reset monthly. ([LiveKit pricing](https://livekit.com/pricing), [quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/))

That is enough for short tests, not a continuously watched season. For example, ten participants connected for one hour consume roughly 600 participant-minutes. Use the existing peer-to-peer mesh for the earliest small test, then enable LiveKit when stable cross-network audio or spectator audio matters.

## Practical choice

- **Least work:** Render + Neon + optional LiveKit Cloud.
- **Always on for $0, if available:** Oracle Always Free, with substantially more manual operations and security responsibility.
- **Not first choices:** Koyeb because of its very small CPU allocation and wake behavior; Cloud Run because long-lived sockets are billable and capped at 60 minutes.

Free tiers are suitable for invited testing. Before a public production launch, budget for an always-on app instance, durable backups, transactional email, monitoring and abuse controls.
