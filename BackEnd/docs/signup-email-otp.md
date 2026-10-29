# Signup email verification — local Phase 1

This is additive and disabled unless `SIGNUP_EMAIL_OTP_ENABLED` is exactly `true`.
No production environment, account, collection, index or historical record is
migrated by this change. Leave the flag unset until the verification UI and the
explicit database setup below are ready. With the flag off, existing signup and
login response contracts remain unchanged. No login 2FA is implemented.

## Configuration (names only; keep values outside Git)

- `SIGNUP_EMAIL_OTP_ENABLED`: exact `true` enables the new signup contract.
- `OTP_HMAC_SECRET`: independent high-entropy random secret, at least 32 bytes;
  must differ from `JWT_SECRET`. Generate securely outside application logs.
- `EMAIL_PROVIDER`: `resend` (default when unset), `smtp`, or `brevo`. Invalid values fail
  closed; no automatic provider fallback or retry occurs.
- `RESEND_API_KEY`: backend-only Resend credential; needed only for Resend.
- `RESEND_FROM_EMAIL`: verified sending address. `onboarding@resend.dev` is suitable
  only for Resend's restricted account-recipient testing, not general signup.
- For SMTP only: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER`,
  `SMTP_APP_PASSWORD`, `SMTP_FROM_NAME`. SMTP uses implicit TLS with certificate
  verification and TLS 1.2 minimum. The structured sender display name is
  `SMTP_FROM_NAME`; its address is `SMTP_USER`. Use a Gmail app password, never
  a normal account password. No SMTP connection is made just to load configuration.
- For Brevo only: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`.
  Use an authorized/verified transactional sender. Delivery uses one HTTPS POST
  to `https://api.brevo.com/v3/smtp/email` with the key in the `api-key` header,
  never in the URL or message body. No SMTP connection or new SDK is needed.
- Existing `MONGO_URI`, `JWT_SECRET`, `PORT`, `MAINTENANCE_WRITE_LOCK` are unchanged.
- Test-only: `EXPENSEIQ_TEST_MONGO_URI` and `EXPENSEIQ_TEST_ALLOW_MUTATIONS=1`.

All integration email delivery is mocked, including provider failure. The tests
must never be pointed at the production cluster. They select a generated
`expenseiq_test_<pid>_<timestamp>` database and drop only that database afterward.
Do not enable the real feature in a local process connected to production.

## Explicit database prerequisites

The new PendingRegistration and SignupRateLimit schemas have both `autoCreate`
and `autoIndex` disabled. Their import does not provision production collections.
Enabled operations fail closed until the necessary collections/indexes exist:

- Pending registrations: unique `{ email: 1 }` named
  `unique_pending_registration_email`; TTL `{ purgeAt: 1 }` with
  `expireAfterSeconds: 0` named `pending_registration_cleanup`.
- Signup limits: default unique `_id`; TTL `{ purgeAt: 1 }` with
  `expireAfterSeconds: 0` named `signup_limit_cleanup`.
- Existing Users: nonpartial, nonsparse unique email index and the exact approved
  `unique_username_string` partial unique index. See `username-index-policy.md`.
  A full `username_1` index alone does not satisfy OTP readiness.
- A transaction-capable replica set/sharded MongoDB deployment is required.

Provision only an isolated development database now. Production setup, a read-only
case-variant email audit, legacy email normalization policy and any remediation
require a separate reviewed migration. Existing email strings are not rewritten.
New emails are trimmed/lowercased; existing-account checks are case-insensitive.
Do not mix enabled OTP writers with older signup writers during a future rollout.

## Endpoints and state

All routes are under `/api/auth/signup`, so the existing maintenance write guard
blocks all three before route handlers when `MAINTENANCE_WRITE_LOCK=true`.

1. `POST /api/auth/signup`: `{ username, email, password }`.
   Enabled validation requires a 3–40-character username using letters, numbers,
   `_`, `.` or `-`, a syntactically valid email up to 254 characters, and a password
   at least 12 characters and at most 72 UTF-8 bytes (bcrypt's input boundary).
   Creates only a disposable pending registration; returns 202 with message,
   `verificationRequired`, `registrationId`, `registrationToken`, `expiresAt`,
   `resendAvailableAt`. It does not create a User or return an application JWT.
2. `POST /api/auth/signup/verify`:
   `{ registrationId, registrationToken, otp }`. The OTP must be a six-digit
   string, preserving leading zeroes. Success returns 201 with safe `id`,
   `username`, `email`, and a sign-in message. No automatic login/JWT.
3. `POST /api/auth/signup/resend`: `{ registrationId, registrationToken }`.
   Success returns 202 with updated challenge times; the capability stays the
   same. Resend and verify return 404 while the flag is disabled.

The 256-bit registration token is an opaque, limited capability. Its SHA-256
digest is stored; only the caller receives the token. It is not a JWT, is never
accepted by authentication middleware, and cannot access groups/expenses. Never
log or place it in URLs. A later UI should keep it only in session memory/storage.

OTP generation uses `crypto.randomInt` and HMAC-SHA-256, bound to registration ID,
generation and signup purpose. OTP plaintext exists only transiently for delivery.
Expiry is five minutes, enforced by server time. Five wrong attempts lock that
generation. Resend is allowed after 120 seconds and replaces the previous OTP.
Resending resets the per-code counter but not persistent request limits.

Verification and resend modify the same pending document inside MongoDB snapshot
transactions. Wrong-attempt increments commit before errors are returned. User
creation, verified metadata and challenge consumption commit together. Concurrent
operations retry against current state; spent/obsolete challenges cannot create
another account. Consumed documents lose password hash, OTP digest and capability
digest. Neither group nor expense records are touched.

## Email delivery failures

Provider delivery is outside MongoDB transactions and never retried automatically
by this service. Each generation has a Resend idempotency key when using Resend;
SMTP and the current Brevo adapter do not provide equivalent server-side idempotency. Pending state is
`sending` until provider acceptance; verification is refused in that state.
Failure/uncertain acceptance marks `delivery_failed`, removes the OTP digest and
creates no User. A failed initial send returns sanitized 503 with the limited
challenge capability so the future UI can retry after the cooldown. No provider
response, API key, OTP or digest is returned. An email accepted before a process
crash can contain an unusable code; resend after cooldown recovers safely. A late
send completion cannot activate a superseded/expired generation. No inbox-delivery
guarantee is made.

Brevo requests have a ten-second timeout, reject redirects and never retry or
fall back to another provider. Only HTTP 201 with a nonempty `messageId` confirms
API acceptance. Authentication, rate-limit, network, malformed-response and other
provider failures use the same sanitized delivery error; response bodies and API
keys are never logged/returned. Existing pending-registration failure handling,
cooldown and single-use verification rules are unchanged. Acceptance does not
prove inbox delivery. Uncertain delivery is not retried automatically.

SMTP connection, greeting and socket timeouts are bounded at ten seconds. SMTP
authentication/TLS/recipient failures are converted to the same sanitized delivery
failure; transports are closed and provider errors are not logged or returned.
Acceptance is checked for the exact single recipient, not merely a generated
message ID. SMTP acceptance is not inbox delivery. After an uncertain disconnect,
the message might have been accepted; the existing cooldown/generation rules make
recovery safe, but do not promise exactly-once external delivery.

## Abuse controls and pending cleanup

Shared MongoDB counters use HMAC-derived keys and atomic increments:

- Signup/resend: 5 requests per IP per 15 minutes and per identity per hour.
- Verify: 30 requests per IP per 15 minutes, 20 per challenge per hour, plus the
  strictly enforced five incorrect guesses per OTP.
- Delivery budget: 100 signup/resend requests per hour globally. Failed/denied
  requests can consume budgets deliberately (fail closed).

429 responses include `Retry-After`. Limits use fixed windows, so bursts across a
boundary are possible; OTP attempts and cooldown do not reset on window boundaries.
The default Express `req.ip` does not trust forwarded client headers. Render can
therefore share an IP budget across clients until an explicit, reviewed proxy trust
configuration is supplied. See [HTTP security configuration](http-security.md) for
the bounded peer allowlist and CORS `Retry-After` exposure. Never use blanket
`trust proxy: true` without topology validation. Additional account-level abuse controls and recovery UX should precede
a broad public rollout.

Pending registrations expire after 24 hours regardless of resends. TTL cleanup is
asynchronous; application checks reject expired challenges immediately. A fresh
signup can reclaim an expired pending email only; active pending passwords and
usernames cannot be overwritten. Losing the registration capability requires
waiting for expiry; no email-only takeover/resume endpoint is provided in Phase 1.
No TTL or cleanup is applied to Users. Requests use safe errors; generic conflict
messages reduce but do not eliminate timing-based account enumeration.

## Legacy users and rollout gates

Users now have `emailVerificationStatus` (`legacy_unverified` or `verified`) and
`emailVerifiedAt`. The earlier `legacy` value remains an unverified compatibility
alias. Missing historical fields are treated as legacy_unverified; no ownership
is inferred, and no data backfill occurs. Existing password login and JWT payload,
lifetime and middleware remain intact. Pending registrations are not Users and
cannot log in. New verified accounts receive `verified` and a timestamp atomically.

An authenticated legacy-email verification/recovery flow, legacy enforcement,
login 2FA and frontend integration are future work. Do not enable the flag with
the old frontend: it currently redirects to login without handling a challenge.
Keep default disabled; implement the verification UI and its tests first.

### Existing test accounts and future email replacement

Existing accounts with fake or inaccessible mailboxes keep normal password login
even with OTP signup enabled. No account is deleted, recreated, auto-verified or
silently edited. IDs, password hashes, membership and financial/history references
remain untouched. Legacy compatibility is not a request parameter, public bypass
endpoint, email-domain exception or hardcoded test-user allowlist. Enabled public
signup always goes through PendingRegistration and cannot create a legacy User.

A later email-change feature should require an authenticated session plus recent
password reauthentication, then send a purpose-bound challenge to the proposed
accessible address. The old mailbox must not be mandatory for this recovery path.
Keep the current email unchanged until the new address is verified. Apply attempt,
expiry, cooldown and account/IP limits, and bind the challenge to the existing user
ID and proposed address. After verification, transactionally consume the challenge
and update only that User's email and verification metadata, enforcing uniqueness
and handling concurrent replacements. Preserve the ID and all password/group/
expense/invitation/notification data. No replacement User is created. Notify the
old mailbox on a best-effort basis without making delivery a recovery prerequisite.
Accounts unable to authenticate need a separate audited operator-assisted recovery
policy; knowledge of a username or old email alone must never authorize recovery.

Any future mandatory legacy enforcement needs a separately approved migration,
recovery UI and grace period. Do not bulk mark emails verified or introduce a
permanent public exemption to make test accounts work.

## Verification

Ordinary suite: `node --test BackEnd/test/*.test.js FrontEnd/test/*.test.js`.
Isolated, opt-in OTP database suite:
`node --test BackEnd/test/signupOtp.integration.test.js`.
The latter creates test-only collections/indexes/fixtures and cleans them up.
