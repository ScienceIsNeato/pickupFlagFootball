# Deploy — Cloud Run

Auto-deploys on every merge to `main` via `.github/workflows/deploy.yml`
(build image → push to Artifact Registry → run migrations → `gcloud run deploy`).
Same approach as the other Neon apps (ChronicChronicler, loopcloser).

The image is a standard Next.js standalone server (`Dockerfile`), so it runs on a
full Node runtime — no edge/adapter constraints.

---

## 1. Fill in the config block

Edit the `env:` block at the top of `.github/workflows/deploy.yml`. Replace every
`CHANGE-ME` / `CHANGE_ME` and confirm the GCP names:

| Key | What |
|---|---|
| `PROJECT_ID`, `REGION`, `REGISTRY`, `IMAGE_NAME`, `SERVICE_NAME` | GCP project / Artifact Registry / Cloud Run service names |
| `APP_BASE_URL` | production URL, e.g. `https://pickupflagfootball.com` |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | transactional email "from" |
| `STRIPE_PRICE_ID` | the donation price id (not secret) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | inlined into the client bundle at build |

## 2. One-time GCP setup

```bash
PROJECT=pickupflagfootball   # match PROJECT_ID
REGION=us-central1

gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com --project=$PROJECT

gcloud artifacts repositories create pickupflagfootball-images \
  --repository-format=docker --location=$REGION --project=$PROJECT
```

## 3. GitHub → GCP auth (CI deploy identity)

Create a deploy service account with roles: `run.admin`, `artifactregistry.writer`,
`secretmanager.secretAccessor`, `iam.serviceAccountUser`. Then either:

- **Workload Identity Federation (preferred):** set repo secrets
  `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT`, or
- **SA key:** set repo secret `GCP_SA_KEY` to the JSON key.

(The workflow accepts either.)

## 4. Create the secrets (values are yours — never commit them)

```bash
for s in pff-database-url pff-database-url-unpooled pff-auth-secret \
         pff-auth-google-id pff-auth-google-secret pff-cron-secret \
         pff-stripe-secret-key pff-stripe-webhook-secret pff-brevo-api-key; do
  gcloud secrets create "$s" --replication-policy=automatic --project=$PROJECT 2>/dev/null || true
done

# add a value (repeat per secret; paste/pipe the real value yourself):
printf '%s' 'THE_VALUE' | gcloud secrets versions add pff-database-url --data-file=- --project=$PROJECT
```

Secrets needed: `DATABASE_URL` (Neon pooled), `DATABASE_URL_UNPOOLED` (Neon direct,
for migrations), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`CRON_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BREVO_API_KEY`.

Sentry error tracking is wired via `@sentry/wizard` (server, edge, and client
init in `sentry.*.config.ts` / `instrumentation-client.ts`, DSN in-code — DSNs
are public by design). It's errors-only (no tracing/replay) to sit in the free
tier. No runtime secret needed.

Optional but recommended: `pff-sentry-auth-token` (a Sentry auth token with
source-map upload scope). When present, the CI build pulls it from Secret
Manager and mounts it into the Docker build so `withSentryConfig` uploads
source maps — making stack traces map to TypeScript instead of minified chunks.
Without it the build still succeeds, just skipping the upload. Create it with:

```bash
gcloud secrets create pff-sentry-auth-token \
  --replication-policy=automatic --project=pickupflagfootball
# portable prompt (works in bash + zsh): print prompt, read silently into TOK
printf 'Sentry auth token: '; read -rs TOK; echo
printf '%s' "$TOK" | gcloud secrets versions add pff-sentry-auth-token \
  --data-file=- --project=pickupflagfootball && unset TOK
```

Locally, the same upload runs off the gitignored `.env.sentry-build-plugin`
(created by the wizard). `org`/`project` are set in `next.config.ts`.

## 5. First-time database

Nothing special: the migrations under `db/migrations` are generated from
`lib/db/schema.ts` (the single source of truth) and build the entire schema —
plus required reference data — from empty. A brand-new database just gets the
normal runner:

```bash
node scripts/migrate.mjs apply    # uses DATABASE_URL_UNPOOLED
# CI runs the same command each deploy.
```

A database that predates the migration squash (already at the current schema,
but whose `schema_migrations` lists the old numbered files) must NOT re-run the
baseline — adopt it once with `node scripts/migrate.mjs baseline`, which marks
the generated files applied without executing them.

Optional bulk data (not in migrations): `node scripts/seed-zip-centroids.mjs`
loads the Census ZIP centroids.

To change the schema: edit `lib/db/schema.ts`, run
`npm run db:generate -- --name <change>`, and commit the generated migration
(including `db/migrations/meta/`). Never hand-write migration SQL —
`npm run db:check` (also run by the e2e suite) fails the build if migrations
and the ORM disagree.

**Migration files are append-only once merged.** Renaming or squashing applied
migrations orphans the `schema_migrations` ledger of every existing database —
the runner then mistakes a live DB for a fresh one and dies replaying the
baseline (this took prod down for a night in July 2026). If a squash is ever
truly necessary, the same PR must ship a reconciliation step for every
existing database's ledger.

**Migration rehearsal (in the deploy pipeline).** Before touching the real
database, the deploy job creates a disposable Neon branch of that env's DB
(copy-on-write), runs `migrate.mjs apply` against the copy, and deletes it.
This tests the upgrade-from-real-history path that the e2e suite's
fresh-bootstrap can't — ledger drift or a bad migration fails against the
copy, never the live DB. Requires the `pff-neon-api-key` secret in Secret
Manager (a Neon org API key) and the env's Neon branch id passed as the
`neon_parent_branch_id` input from deploy-{dev,prod}.yml. `migrate.mjs` also
refuses to apply the first migration file into a non-empty database whose
ledger doesn't record it — the orphaned-ledger signature — instead of failing
mid-DDL.

## 6. Cron (replaces the old Vercel cron)

Cloud Scheduler hits the tick route **twice daily** (05:00/17:00 UTC) with the
`CRON_SECRET` bearer.

That's enough because the engine is event-driven: every run arms a one-shot
Cloud Task for its next real boundary (`scheduleNextTick`), including an
immediate one whenever email is queued — so mail and deadlines don't wait on
this job. It exists only as the dead-man backstop for a missed enqueue.

Twice rather than once for a monitoring reason, not an engine one: Cloud
Monitoring caps metric-absence conditions at 23h30m, so a once-daily tick
cannot have a working "tick down" alert — the threshold would always expire in
the gap before the next run and page every day. A 12-hour cadence lets the
alert sit at 13h with real margin, and the second wake costs ~$0.13/month.

Cadence matters for cost, not just tidiness: each tick wakes the Neon compute,
which then idles a fixed 5 minutes before scale-to-zero, so a frequent cron
bills exactly like an always-on database. Hourly on prod plus 15-minute on dev
cost ~$9/month on a site with no users. If you shorten this schedule, you are
buying an always-awake database — don't, unless you also know why the
event-driven arm isn't doing its job.

```bash
gcloud scheduler jobs create http pff-mime-tick \
  --location=$REGION --schedule="0 5,17 * * *" \
  --uri="$APP_BASE_URL/api/mime/tick" --http-method=POST \
  --headers="Authorization=Bearer THE_CRON_SECRET" \
  --project=$PROJECT
```

(Use the same value as the `pff-cron-secret` secret. The route fails closed if it
doesn't match.)

Dev has its own `pff-dev-mime-tick` job pointing at `dev.pickupflagfootball.com`,
on the same twice-daily schedule and for the same reason.

Both have a `MIME-FF · <env> tick down` alert policy (Cloud Monitoring) watching
the `mime_tick_ok_<env>` log metric, firing after 13h of absence. If you change
the cron cadence, change those thresholds with it — they only make sense as a
pair, and a mismatch is either a daily false page or a dead backstop nobody
notices.

## 7. Custom domain

```bash
gcloud beta run domain-mappings create --service=pickupflagfootball-prod \
  --domain=pickupflagfootball.com --region=$REGION --project=$PROJECT
# then add the DNS records it prints.
```

---

Once 1–4 are done, **merge to `main`** and the workflow builds, migrates, and
deploys. Steps 5–7 are first-time only.

## 8. Slack notifications

Two surfaces (same split ganglia/firstinq use). Both are optional and off until
wired — nothing here blocks a normal deploy.

**Activity feed → `#mime-activity`** — the app posts product events (new player,
site proposed, proposal formed, proposal stalled) to an incoming webhook,
best-effort and non-blocking. Unset `SLACK_WEBHOOK_URL` = silent no-op.

```bash
# 1. In Slack: create #mime-activity (+ a dev channel) and add an Incoming Webhook
#    to each → copy the URLs. Store as secrets:
printf '%s' 'https://hooks.slack.com/services/PROD/...' | \
  gcloud secrets create pff-slack-webhook-url     --replication-policy=automatic --data-file=- --project=$PROJECT
printf '%s' 'https://hooks.slack.com/services/DEV/...'  | \
  gcloud secrets create pff-dev-slack-webhook-url --replication-policy=automatic --data-file=- --project=$PROJECT
```

```yaml
# 2. Turn it on by passing the secret name (the pipeline binds it additively;
#    leaving it out = Slack off, deploy unaffected):
#   .github/workflows/deploy-prod.yml  with:  slack_webhook_secret: pff-slack-webhook-url
#   .github/workflows/deploy-dev.yml   with:  slack_webhook_secret: pff-dev-slack-webhook-url
```

**Tick alerts → `#mime-alerts`** — a dead server can't report itself, so "tick is
down" is a Cloud Monitoring alert, not an app event.

1. Authorize the **Google Cloud Monitoring** Slack app in the workspace, then add a
   Slack **notification channel** pointing at `#mime-alerts`
   (Console → Monitoring → Alerting → Edit notification channels → Slack).
2. Create two alert policies on that channel:
   - **Missed tick** — 0 successful (2xx) requests to `/api/mime/tick` in 13h,
     i.e. one missed twice-daily backstop (covers scheduler-paused / route-down).
     Keep this window between 1× and 2× the cron interval: below the interval it
     false-alarms in the gap between ticks, and Cloud Monitoring refuses any
     metric-absence threshold above 23h30m — which is the whole reason the cron
     runs twice daily instead of once.
   - **Tick errors** — any `severity>=ERROR` log from the `pickupflagfootball-prod`
     Cloud Run service (covers the engine throwing *and* the email-flush failures,
     which log an error but still return 200).
