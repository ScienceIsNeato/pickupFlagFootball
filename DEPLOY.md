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

## 5. First-time database

The migration runner handles incremental migrations. A brand-new database also
needs the baseline first:

```bash
# against DATABASE_URL_UNPOOLED:
psql "$DATABASE_URL_UNPOOLED" -f db/schema.sql      # baseline snapshot
node scripts/migrate.mjs baseline                   # mark snapshot applied
# CI then runs `node scripts/migrate.mjs apply` each deploy.
```

## 6. Cron (replaces the old Vercel cron)

Cloud Scheduler hits the tick route every 15 min with the `CRON_SECRET` bearer:

```bash
gcloud scheduler jobs create http pff-mime-tick \
  --location=$REGION --schedule="*/15 * * * *" \
  --uri="$APP_BASE_URL/api/mime/tick" --http-method=POST \
  --headers="Authorization=Bearer=THE_CRON_SECRET" \
  --project=$PROJECT
```

(Use the same value as the `pff-cron-secret` secret. The route fails closed if it
doesn't match.)

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
   - **Missed tick** — 0 successful (2xx) requests to `/api/mime/tick` in 30 min
     (covers scheduler-paused / route-down).
   - **Tick errors** — any `severity>=ERROR` log from the `pickupflagfootball-prod`
     Cloud Run service (covers the engine throwing *and* the email-flush failures,
     which log an error but still return 200).
