# Meta WhatsApp Cloud API setup

Sthyra is the Meta Tech Provider and owns one production Meta Developer app.
Individual CRM customers do **not** create developer apps. In Activity →
WhatsApp → Setup they complete Meta Embedded Signup and select their Business
Portfolio, WhatsApp Business Account (WABA), and phone number.

## One-time Sthyra setup

1. Create a Meta Business app and add the WhatsApp product.
2. Complete Meta business verification and switch the app to Live.
3. Request advanced access/app review for `whatsapp_business_management` and
   `whatsapp_business_messaging`.
4. Create an Embedded Signup configuration for customer onboarding.
5. Configure the callback URL as
   `https://<production-host>/api/whatsapp/webhook`, subscribe to the `messages`
   field, and use the same verify token as
   `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
6. Add the environment variables documented in `.env.example`, including a
   stable 32-byte `INTEGRATION_TOKEN_ENCRYPTION_KEY` and `CRON_SECRET`.
7. Apply `database/migrations/20261027_create_whatsapp_cloud_platform.sql`.

## Customer flow

1. A company administrator selects a CRM project and clicks **Connect with
   Meta**.
2. Meta authenticates the administrator and lets them select or create their
   Business Portfolio, WABA, and business phone number.
3. Sthyra exchanges the short-lived signup code on the server, encrypts the
   token, subscribes the app to WABA webhooks, and saves the selected number.
4. The administrator creates or edits templates from Activity → WhatsApp →
   Templates. Meta reviews each submission; only approved templates can be
   used in messages and automations.
5. The sales team records WhatsApp opt-in on the contact. They can send an
   approved template at any permitted time, or a free-form reply for 24 hours
   after the customer's latest inbound message.
6. Automations use approved templates and are processed by the retryable
   `/api/whatsapp/jobs/process` cron worker.

Never place the Meta app secret, access tokens, webhook verify token, or
integration encryption key in browser-visible environment variables.
