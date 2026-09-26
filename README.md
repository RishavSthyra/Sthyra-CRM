This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Authentication configuration

Set `AUTH_SECRET` in `.env.local` to a cryptographically random value of at least
32 characters before using any `/api/auth/*` endpoint. For example, generate one
with `openssl rand -base64 48` and store the output as the environment value.

Password-reset tokens are stored hashed in `password_reset_tokens`. The
`POST /api/auth/forgot-password` route contains the integration point where the
raw token must be delivered by your email provider. For local API testing only,
set `AUTH_EXPOSE_RESET_TOKEN=true`; this flag is ignored in production.

Workspace invitations are sent over SMTP. Configure these values in
`.env.local` (or in your deployment environment):

```bash
APP_URL=http://localhost:3000
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM="Sthyra CRM <no-reply@example.com>"
```

Invitation tokens expire after seven days and only their SHA-256 hashes are
stored. Resending or copying a fresh link rotates the token, invalidating the
previous link.

### Google login and connected email accounts

Copy the OAuth values from `.env.example` into `.env.local`. In Google Cloud,
create a web OAuth client and register these exact redirect URLs:

```text
http://localhost:3000/api/auth/google/callback
http://localhost:3000/api/email-connections/google/callback
```

Enable the Gmail API. Google login requests only identity scopes; connecting a
sender from Settings separately requests `gmail.send` and offline access.

For Microsoft 365, create an Entra web app, add the callback below, and grant
delegated `Mail.Send`, `openid`, `profile`, `email`, and `offline_access`:

```text
http://localhost:3000/api/email-connections/microsoft/callback
```

Generate `EMAIL_TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`. Mailbox
access and refresh tokens are AES-256-GCM encrypted in PostgreSQL and are never
returned to the browser. The CRM records outbound messages in a durable queue;
invoke `POST /api/email-jobs/process` with `Authorization: Bearer $CRON_SECRET`
from a scheduler to process retries. SMTP remains reserved for product email
such as invitations and password resets.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
