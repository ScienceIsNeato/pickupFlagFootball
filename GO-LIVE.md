# Go-Live — click-by-click

Everything you do in a browser, in order. Tailored to: **new GCP project**,
**custom domain**, **new Neon prod branch**, **Stripe test mode**.

> Wherever you see **`YOURDOMAIN.com`**, use your real domain. Tell Claude the
> domain and it'll bake it into the deploy workflows (`deploy-prod.yml` /
> `deploy-dev.yml`) for you.
>
> Steps marked 🤖 are ones Claude can run for you (DB prep, the file edits).
> Everything else is you, in a browser.

---

## 1 · Neon — make a clean production database

1. Open **https://console.neon.tech** → your pickupFlagFootball project.
2. Left sidebar → **Branches** → **New Branch**.
   - Name: `production`. Parent: your current `main`/`dev` branch. **Create**.
3. Still on the `production` branch → top-right **Connect** button.
   - A panel opens with a **Connection string**.
   - **Pooled** toggle **ON** → copy it → this is **`DATABASE_URL`**. Paste it
     into a scratch note for now.
   - **Pooled** toggle **OFF** → copy it → this is **`DATABASE_URL_UNPOOLED`**.
4. 🤖 Tell Claude when the branch exists — it'll reset it to a clean schema
   built straight from the migrations, so production starts empty. (Or do it
   yourself against the prod URL: drop/recreate the `public` schema, then
   `node scripts/migrate.mjs apply` +
   `node --env-file=.env.local --import tsx scripts/seed-demo-interest.ts --clean`.)

## 2 · Google Cloud — create the project

1. **https://console.cloud.google.com/projectcreate**
   - Project name: `pickupflagfootball`. **Create.** Wait for it, then make sure
     it's selected in the top bar (the project picker next to "Google Cloud").
2. **Billing** must be on: **https://console.cloud.google.com/billing** → link a
   billing account to the project. (Cloud Run has a free tier; this is just
   required to enable the APIs.)
3. **Enable the 4 APIs** — open each link (project selected) and click **Enable**:
   - Cloud Run: https://console.cloud.google.com/apis/library/run.googleapis.com
   - Artifact Registry: https://console.cloud.google.com/apis/library/artifactregistry.googleapis.com
   - Secret Manager: https://console.cloud.google.com/apis/library/secretmanager.googleapis.com
   - Cloud Scheduler: https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com
4. **Create the image repo** — https://console.cloud.google.com/artifacts →
   **Create Repository**.
   - Name: `pickupflagfootball-images` · Format: **Docker** · Mode: Standard ·
     Region: **us-central1** → **Create**.

## 3 · Collect the secret values

Gather these into your scratch note; you'll paste them into Secret Manager in §4.

**Google sign-in** (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`)
1. https://console.cloud.google.com/apis/credentials (pick the project that owns
   your existing OAuth client — likely the same Google account you used in dev).
2. Under **OAuth 2.0 Client IDs**, open your **Web** client (or **Create
   Credentials → OAuth client ID → Web application** if none).
3. **Authorized JavaScript origins** → Add `https://YOURDOMAIN.com`
   **Authorized redirect URIs** → Add `https://YOURDOMAIN.com/api/auth/callback/google`
   → **Save**.
4. Copy **Client ID** → `AUTH_GOOGLE_ID`, **Client secret** → `AUTH_GOOGLE_SECRET`.
5. ⚠️ **OAuth consent screen** → https://console.cloud.google.com/apis/credentials/consent
   — if Publishing status is "Testing", click **Publish app** so anyone can log
   in (basic email/profile scopes don't need Google verification).

**Stripe — test mode** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`)
1. Toggle **Test mode** ON (top-right switch) in the Stripe dashboard.
2. Secret key: https://dashboard.stripe.com/test/apikeys → reveal **Secret key**
   (`sk_test_…`) → `STRIPE_SECRET_KEY`.
3. Price id: https://dashboard.stripe.com/test/products → open your donation
   product → the price → copy the **API ID** (`price_…`) → `STRIPE_PRICE_ID`.
4. Webhook: https://dashboard.stripe.com/test/webhooks → **Add endpoint**.
   - Endpoint URL: `https://YOURDOMAIN.com/api/stripe/webhook`
   - **Select events** → add exactly: **`checkout.session.completed`** and
     **`customer.subscription.deleted`** → **Add endpoint**.
   - On the new endpoint page → **Signing secret** → **Reveal** (`whsec_…`) →
     `STRIPE_WEBHOOK_SECRET`.

**Brevo email** (`BREVO_API_KEY`)
- https://app.brevo.com/settings/keys/api → **Generate a new API key** → copy →
  `BREVO_API_KEY`.

**Generated secrets** (`AUTH_SECRET`, `CRON_SECRET`) — 🤖 ask Claude to generate
two random values, or run `openssl rand -base64 33` twice yourself.

## 4 · Secret Manager — store the 9 secrets

https://console.cloud.google.com/security/secret-manager (project selected) →
**Create Secret**, once per row below. Name = left column exactly, Secret value =
paste the matching value, leave everything else default, **Create Secret**.

| Secret name | Value |
|---|---|
| `pff-database-url` | Neon **pooled** string |
| `pff-database-url-unpooled` | Neon **direct** string |
| `pff-auth-secret` | generated AUTH_SECRET |
| `pff-auth-google-id` | Google Client ID |
| `pff-auth-google-secret` | Google Client secret |
| `pff-cron-secret` | generated CRON_SECRET |
| `pff-stripe-secret-key` | `sk_test_…` |
| `pff-stripe-webhook-secret` | `whsec_…` |
| `pff-brevo-api-key` | Brevo key |

## 5 · CI identity — let GitHub deploy to GCP

1. **Create a service account** — https://console.cloud.google.com/iam-admin/serviceaccounts
   → **Create Service Account**. Name `github-deployer` → **Create and continue**.
2. **Grant roles** (Select a role → repeat for each, then **Done**):
   - Cloud Run Admin
   - Artifact Registry Writer
   - Secret Manager Secret Accessor
   - Service Account User
3. **Make a key** — open the new account → **Keys** tab → **Add Key → Create new
   key → JSON** → it downloads a `.json` file. Keep it safe; you'll paste it next.
4. **Put it in GitHub** — https://github.com/ScienceIsNeato/pickupFlagFootball/settings/secrets/actions
   → **New repository secret**.
   - Name: `GCP_SA_KEY` · Secret: paste the **entire contents** of the JSON file
     → **Add secret**.

## 6 · 🤖 Fill the workflow + finalize

Tell Claude your **domain** and your **GCP project ID** (and your **Brevo sender
email** + the **support email**). Claude fills the `env:` / `with:` blocks in the
deploy workflows — `.github/workflows/deploy-prod.yml` and `deploy-dev.yml`, which
both call the shared `_pipeline.yml` — and confirms the project/region names match
what you created.

- **`STRIPE_PRICE_ID`** is set here too, as the `stripe_price_id` workflow input
  (it's a build-time env value, not a Secret Manager secret).
- **Slack activity feed (optional):** create a `pff-slack-webhook-url` secret (same
  as §4) and it's wired in via the `slack_webhook_secret` input — leave that input
  empty to keep Slack off. Prod and dev point at their own webhook secrets.

## 7 · Verify domain ownership (needed for the custom domain)

1. https://search.google.com/search-console → **Add property** → **Domain** →
   enter `YOURDOMAIN.com`.
2. It gives you a **TXT record**. Add it at your domain registrar's DNS page
   (where you bought the domain) → back in Search Console click **Verify**.

## 8 · Ship it 🚀

🤖 Claude pushes the branch and opens the PR. You **merge it to `main`** on
GitHub → the **Deploy to Cloud Run** action runs (Actions tab shows progress):
build → migrate → deploy. First run takes a few minutes.

Watch it: https://github.com/ScienceIsNeato/pickupFlagFootball/actions

## 9 · After the first deploy

**Map your domain** — https://console.cloud.google.com/run → open
`pickupflagfootball-prod` → **Manage Custom Domains** (or Cloud Run → Domain
mappings) → **Add mapping** → service `pickupflagfootball-prod`, domain
`YOURDOMAIN.com` → it prints **DNS records** (A/AAAA or CNAME). Add them at your
registrar. SSL provisions automatically in a few minutes.

**Turn on the cron** — https://console.cloud.google.com/cloudscheduler →
**Create Job**.
- Region: us-central1 · Name: `pff-mime-tick` · Frequency: `*/15 * * * *` ·
  Timezone: any.
- Target type: **HTTP** · URL: `https://YOURDOMAIN.com/api/mime/tick` ·
  Method: **POST**.
- **Add a header**: name `Authorization`, value `Bearer <your CRON_SECRET>`
  (the same value you stored in `pff-cron-secret`).
- **Create**, then open the job → **Force run** once to confirm it returns 200.

**Done.** Every future merge to `main` redeploys automatically.
