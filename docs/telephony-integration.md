# Telephony integration contract

Sthyra uses a provider-neutral adapter. Configure the provider variables from
`.env.example`; production must not enable `TELEPHONY_ALLOW_SIMULATION`.

## Outbound provider API

The configured `TELEPHONY_PROVIDER_API_URL` must accept:

- `POST /calls` to start a call. Return an `id` or `call_id`.
- `POST /calls/{providerCallId}/actions/{action}` where `action` is `end`,
  `hold`, `resume`, `mute`, `unmute`, or `live-transfer`.
- `GET /recordings/{recordingId}/access` to return a short-lived recording URL.

Every provider request receives `Authorization: Bearer
TELEPHONY_PROVIDER_API_KEY`.

## Provider webhooks

Send lifecycle events to `POST /api/telephony/events`. Send inbound routing
requests to `POST /api/telephony/inbound-route`. Authenticate either with
`Authorization: Bearer TELEPHONY_WEBHOOK_SECRET` or an
`x-telephony-signature` containing the hex HMAC-SHA256 of the raw body.

Lifecycle events require `provider`, `event_id`, and `type`. Include either
`crm_call_id` or `provider_call_id`, plus a provider status. Event IDs are
idempotent. Recording updates can be sent as:

```json
{
  "recording": {
    "id": "provider-recording-id",
    "status": "available",
    "url": "optional-provider-url"
  }
}
```

Inbound routing requests require `provider_call_id`, `from`, and `to`.
Provision each company number in `telephony_phone_numbers`; the route can point
to a user or team. Phone matching ignores formatting characters.
