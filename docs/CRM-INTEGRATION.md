# Deskzo CRM integration

Every lead this site captures is also sent to the Deskzo CRM through its lead
capture API (`POST /api/v1/leads`), where Deskzo scores it and assigns it by its
own rules. The lead is always saved here first; the CRM gets a copy.

## Switching it on

1. In Deskzo, open **Settings → Lead capture API** and create a key for this
   website. Copy the secret — Deskzo shows it once.
2. Set these in the deployment's environment (Coolify → Environment Variables)
   and redeploy:

   | Variable | Value |
   |---|---|
   | `DESKZO_KEY_ID` | The key ID |
   | `DESKZO_SECRET` | The secret |
   | `DESKZO_API_URL` | Optional. Defaults to `https://bisleriwater.deskzo.com/api/v1/leads` |

3. In the admin, open **Settings → CRM Integration** and press **Test
   connection**. It checks the key without creating anything.
4. Optionally, press **Send existing leads** to send the leads captured before
   the integration was on. Deleted leads and leads marked as spam are skipped.

The secret lives only in the environment — never in the database, the page or
the browser. Production refuses to start with only half of the key pair, or
with an endpoint that is not `https://`.

## What is sent

| Deskzo field | From this site |
|---|---|
| `name`, `email`, `phone`, `company` | The lead |
| `designation` | The lead's job title |
| `country` | The market the lead came through (India, UAE…) |
| `message` | The visitor's message |
| `product_interest` | The product, or “Enquiry via ‹form name›” |
| `products` | The product's SKU, when it has one |
| `quantity` | A form field named `quantity`, `seats_needed`, `seats`, `users` or `licences`, when a product is sent |
| `budget` | The lead's value, when set |
| `source` | `website` for every form lead; for leads added by staff, read from their source text |
| `page_url` | The page the form was on |
| `utm_source`, `utm_medium`, `utm_campaign` | Last touch, falling back to first touch |
| `city`, `state`, `pincode` | Form fields with exactly those names |
| `custom_fields` | Form fields named `licence_type`, `seats_needed`, `current_licence_expiry`, `competing_partner` |
| `company_fields` | A form field named `tenant_domain` |
| `external_id` | This site's lead id |

To send one of Deskzo's own fields, give the form field the same name as the
Deskzo key. Every other form field stays in this site's submission record.

`external_id` is what makes retries safe: Deskzo answers a repeat with the lead
it already has instead of creating a second one.

## When the CRM cannot take a lead

The visitor never notices — their submission succeeds either way. Each lead's
state is on the lead itself, under **Deskzo CRM**:

| State | Meaning |
|---|---|
| In the CRM | Deskzo created it (or already had it). Its reference, e.g. `LEAD-000481`, is shown. |
| Routed to a reseller | Deskzo accepted it for a company a reseller manages; no CRM lead was created. |
| Waiting to send | Queued, or being retried after a temporary failure. |
| Not sent | Deskzo refused it (a 400), or twelve retries failed. The reason is shown. |

Temporary failures — Deskzo down, a timeout, the rate limit, a wrong or revoked
key — are retried after 1, 2, 4, 8… minutes, up to six hours apart, twelve
times. Fix the cause and press **Retry failed** in Settings, or **Retry now**
on a lead.

## Retries need a scheduler

New leads are sent the moment they arrive, and each new lead also sends a few
retries that are due. For dependable retries, call the queue every five
minutes with the same `CRON_SECRET` as scheduled backups:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-site>/api/internal/cron/crm-sync
```

It sends up to 50 due leads per call, which keeps a backlog under Deskzo's
limit of 60 leads a minute per key.
