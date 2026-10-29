# Client IP trust and browser retry feedback

Proxy trust defaults to `false`: forwarding headers cannot select an OTP rate-limit
identity. Equivalent IPv6 and IPv4-mapped addresses are normalized before hashing.
The persistent limiter's account/challenge budgets remain unchanged.

## Shared-proxy availability policy

`SIGNUP_RATE_LIMIT_POLICY` defaults to `strict`. The opt-in `shared_proxy` value
increases only the 15-minute socket-IP budgets: signup/resend from 5 to 20 each,
and verification from 30 to 120. No other values are accepted; invalid configuration
fails OTP requests with 503 before counter writes. This does not enable proxy trust.
Keep `TRUSTED_PROXY_CIDRS` and `TRUSTED_PROXY_MAX_HOPS` unset on unverified Render ingress.

Email/challenge limits are now checked first: signup 5/email/hour, resend
5/challenge/hour, verify 20/challenge/hour. Repeated attempts beyond those limits
do not drain the shared-IP budget. The global 100/hour signup-and-resend email
budget, five wrong OTP attempts, expiry and resend cooldown remain unchanged.
Counters include attempts, not just successful deliveries. Fixed windows allow
boundary bursts; rejected aggregate requests can still consume identity counters.

For a limited Render rollout, recommend `SIGNUP_RATE_LIMIT_POLICY=shared_proxy`
only with explicit acceptance of shared availability risk and monitoring of 429s
and provider usage. It is a bounded compromise, not reliable client-IP throttling.
Rotating emails/challenges cannot remove the socket budget, and rotating network
peers cannot remove the global mail budget. Attackers can still exhaust shared
budgets or target a victim's email. Render peer changes can create new IP buckets;
verification has no global request cap. Monitor database load, retain the disabled
OTP feature flag as rollback, and consider server-verified anti-bot controls before
a broad rollout. Do not solve availability by trusting spoofable headers or
disabling limits. No settings are changed by this documentation.

`TRUSTED_PROXY_CIDRS` optionally accepts comma-separated literal IPs or narrow CIDRs
(IPv4 /24 or narrower, IPv6 /64 or narrower). `TRUSTED_PROXY_MAX_HOPS` bounds the
right-to-left trust walk, defaults to 1 when an allowlist exists, and accepts 1–5.
Both the peer address and its hop position must be trusted. Invalid configuration
fails startup. These bounds do not prove that an address actually belongs to Render.

Do not populate either variable in production until Render confirms the service's
inbound peer identities and forwarding-header replacement/append behavior, including
alternate ingress paths. Do not use Render's outbound IP ranges, blanket trust,
arbitrary private networks, a guessed hop count, or the leftmost X-Forwarded-For value.
Without verified ingress evidence, production activation remains blocked; the safe
default may combine legitimate clients behind a proxy into one IP budget.

Validate a proposed allowlist in staging using known separate clients and forged
forwarding prefixes. Confirm distinct clients resolve separately, forged prefixes
cannot change their budgets, and direct/untrusted paths ignore forwarding headers.
Do not add a public diagnostic endpoint or log tokens, cookies, OTPs or full headers.
Trusted network peers must append the actual connecting address or overwrite forged
headers; allowlisting alone cannot fix a proxy that forwards attacker-selected IPs.

`CORS_ALLOWED_ORIGINS` is an optional comma-separated list of exact HTTPS origins
(HTTP allowed only for loopback development). The default is
`https://expenseiq-tracker-app.netlify.app`. Add legitimate custom frontend domains
explicitly. Wildcards, null origins, credentials and URL paths are rejected.
Allowed origins receive `Access-Control-Expose-Headers: Retry-After`, including
429 and maintenance responses. Authorization headers and API methods are preserved;
cookie credentials are not enabled. Requests without Origin still work. CORS is
browser response access control, not a substitute for backend authentication.

References checked for this implementation:
- https://expressjs.com/en/guide/behind-proxies.html
- https://render.com/docs/web-services
- https://render.com/docs/outbound-ip-addresses

Render's public documentation reviewed here does not establish this service's
inbound proxy CIDRs or a guaranteed trust-hop topology. Obtain service-specific
confirmation before enabling forwarded client identities.
