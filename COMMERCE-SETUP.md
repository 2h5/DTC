# DTC commerce: architecture, security model, and launch gates

> **Status: pre-launch scaffolding. Online payment is intentionally disabled.**
> The repository does not yet have a selected production host, PayPal
> credentials, an approved sell-price catalog, final tax/shipping/return terms,
> a production-grade durable order store, or an operational owner. The bundled
> JSON store is sandbox-only and live mode refuses to start. Keep checkout disabled until
> every required gate in this document is signed off.

This is an engineering and operations guide, not legal, tax, insurance, or
accounting advice. Technical controls reduce specific risks; they do not remove
business obligations, prevent every failure, or guarantee that a policy is
enforceable. DTC's authorized business owner and qualified advisers must approve
the commercial and legal decisions called out below.

---

## 1. Current behavior and trust boundary

The static site can hold a cart. Order creation sends only SKU and quantity;
capture/status also send the PayPal order ID plus an opaque, memory-only order
token. `server/catalog.json` is the source of truth for prices and checkout
eligibility. The PayPal client secret must exist only in the backend's secret
store.

```text
Browser on docs/                   Checkout backend                  PayPal
-------------------------------   -------------------------------   ----------------
local cart: [{sku, qty}]           durable order + event records     order/capture
display-only catalog              authoritative catalog              payment service
public PayPal client id           private PayPal secret
        |                                  |                               |
        +---- create/capture requests ---->|---- Orders v2 API ----------->|
        |<--- public order/status data -----|<--- API + signed webhooks -----|
```

The browser is untrusted. A visitor can change local storage, HTML, JavaScript,
and network requests. Therefore:

- The backend must validate every request and compute every amount from its own
  approved catalog.
- A PayPal response is not an internal order record. Persist the expected order,
  payment attempts, verified events, and final state in DTC's own durable store.
- A successful browser callback is not a fulfillment signal. Fulfill only from
  a persisted, verified paid state.
- CORS is a browser control, not authentication. It does not stop direct calls
  made outside a browser.

### Relevant files

| Area | Path | Responsibility |
| --- | --- | --- |
| Public config | `docs/assets/js/commerce/commerce-config.js` | Explicit mode/create gates, backend origin, public PayPal client ID, and compatibility values |
| Display catalog | `docs/assets/js/commerce/commerce-catalog.js` | Browser display copy; never authoritative |
| Cart store/UI | `docs/assets/js/commerce/cart.js`, `cart-ui.js` | Untrusted local cart and accessible UI |
| Checkout UI | `docs/assets/js/commerce/checkout.js` | PayPal SDK and customer-facing states |
| Checkout API | `server/` | Validation, pricing, PayPal calls, order state, webhooks |
| Price truth | `server/catalog.json` | Approved charge price, currency, purchasability |
| Policies | `docs/*-policy.html`, `docs/terms-of-service.html` | Drafts until business/counsel approval |

The display and server catalogs are a pair, but deployment order matters: deploy
the authoritative backend catalog first, verify it, and only then publish the
matching display catalog. A mismatch must fail closed rather than charge an
unexpected amount.

---

## 2. Non-negotiable go-live blockers

Do not add live config values or enable a purchasable SKU until all of these are
complete:

- [ ] DTC has selected a supported backend host with HTTPS, a durable managed
      database, encrypted backups, secrets management, log retention controls,
      health checks, and alerting.
- [ ] Production runs a currently supported LTS release. As of July 2026, Node
      24 LTS is the preferred baseline; Node 22 remains LTS but is later in its
      support window. Node 18 and 20 are end-of-life and must not be used.
- [ ] `server/package-lock.json` is committed, deployment uses `npm ci`, and CI
      fails on lockfile drift, failed tests, or an approved vulnerability
      threshold. `npm audit --omit=dev` is reviewed; never apply
      `npm audit fix --force` blindly.
- [ ] Sandbox and live PayPal apps are separate. Client IDs, secrets, and
      webhook IDs are stored in the host's secret manager, never in `docs/`,
      logs, issue trackers, screenshots, or source control.
- [ ] PayPal's live account/app is approved and the expected live merchant ID is
      recorded server-side for payee verification.
- [ ] A durable order state model, unique constraints, verified webhook handler,
      scheduled reconciliation, and an operator order queue are implemented and
      tested across process restarts and multiple server instances.
- [ ] Every SKU's exact sell price, currency, condition, stock rule, maximum
      quantity, warranty, and fulfillment lead time is approved by an authorized
      DTC owner. Estimates are not purchasable prices.
- [ ] Tax collection/nexus, shipping charges and destinations, duties, title/risk
      transfer, cancellations, returns, restocking, refunds, warranty, privacy,
      retention, and accessibility are approved by the appropriate business
      owner and qualified advisers.
- [ ] Terms and Privacy have been reviewed against the deployed system; the
      visibly launch-pending Refund and Shipping scaffolds have been replaced
      with approved policies and had their draft notices/`noindex` directives
      removed. Checkout presents the applicable policies before payment.
- [ ] Customer support owns monitored channels and written runbooks for unknown
      captures, refunds, duplicate reports, shipment delays, disputes,
      reversals, fraud, privacy requests, and security incidents.
- [ ] The full automated and PayPal sandbox test matrices below pass from the
      production-like deployment with the final CSP and response headers.
- [ ] A rollback switch can immediately disable new order creation while leaving
      reconciliation, refunds, and existing-order support available.

Until then, public `checkoutMode` stays `"off"`, public/server
`createEnabled` stays false, and every unapproved server catalog item keeps
`"checkout.live": false`. The current estimate is sandbox-only.

---

## 3. Required order and payment design

### 3.1 Durable records

Use a transactional database, not memory and not PayPal's dashboard as the sole
record. At minimum, persist:

- an internal immutable order ID and timestamps;
- the normalized SKU, quantity, unit price, currency, condition, and calculated
  total captured at order creation;
- catalog/version reference and the customer-visible policy versions accepted;
- PayPal order ID, capture ID, merchant/payee ID, and stable idempotency keys;
- state and append-only state transitions (`CREATED`, `APPROVED`,
  `CAPTURE_PENDING`, `CAPTURE_UNKNOWN`, `PAID`, `DENIED`, `REFUNDED`,
  `PARTIALLY_REFUNDED`, `REVERSED`, `CANCELED`, as applicable);
- sanitized PayPal issue codes and `debug_id`, never an unrestricted response
  dump;
- verified webhook event IDs with a unique constraint and processing status;
- reconciliation/refund/fulfillment status and an audit trail of operator
  actions.

Store only information needed for payment, fulfillment, support, fraud control,
and legal/accounting obligations. Do not store full card credentials or PayPal
access tokens in the order record. Encrypt sensitive fields and backups, apply
least-privilege access, and approve a documented retention/deletion schedule.

### 3.2 Create order

1. Reject disallowed origins where an Origin header is present, but do not treat
   this as authentication.
2. Validate content type and a strict JSON schema; reject unknown fields,
   duplicate SKUs, invalid quantities, oversized bodies, excessive line counts,
   and unavailable/non-purchasable products.
3. Recompute totals with integer minor units from the server catalog. Validate
   currency and maximum order value.
4. In one transaction, create an internal order snapshot and a stable
   create-operation idempotency key. Prevent accidental duplicate submissions
   with an application-level key/unique constraint.
5. Create the PayPal order server-side. Include internal correlation data that
   does not expose sensitive information. Persist the PayPal ID before returning
   it to the browser.
6. Return only the fields the browser needs. Never return secrets, access tokens,
   payer data, raw upstream errors, or stack traces.

### 3.3 Capture and ambiguous outcomes

Payment capture is not safe to model as a single request/response. A timeout or
HTTP 5xx can happen after PayPal has moved money.

1. Look up the PayPal order in DTC's store and acquire an order-level lock or
   equivalent compare-and-set transition. Never trust a client-provided cart at
   capture time.
2. Re-fetch the PayPal order and compare it with the immutable internal snapshot:
   merchant/payee ID, currency, total, SKU/quantity details, and acceptable
   approval state. A mismatch blocks capture and alerts an operator.
3. Capture using one stable, operation-specific `PayPal-Request-Id`. Reuse the
   exact same key for all retries of that capture. PayPal stores Orders v2
   capture keys for six hours by default, so DTC's own durable idempotency and
   reconciliation must outlive PayPal's window.
4. On a network error or 5xx, retry the same capture at least once with the same
   key, bounded timeout, and backoff. Never create a new PayPal order to resolve
   an unknown capture.
5. If status is still unknown, persist `CAPTURE_UNKNOWN`, show the buyer a neutral
   message with the DTC order reference (for example, “We are confirming your
   payment. Do not submit another payment”), and reconcile through PayPal GET,
   verified webhooks, and an operator queue.
6. Mark an order `PAID` only after a completed capture with the expected payee,
   amount, and currency has been persisted. A `PENDING` capture is not ready for
   fulfillment.
7. Duplicate capture calls return the persisted result. They do not capture,
   email, decrement stock, or create a fulfillment job twice.

PayPal explicitly recommends repeating an unclear `/capture` call with the same
`PayPal-Request-Id`; do not tell a customer “you were not charged” when the
outcome is unknown.

### 3.4 Webhooks

Subscribe the live app only to events DTC handles. For standard checkout this
normally includes `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`,
`PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, and
`PAYMENT.CAPTURE.REVERSED`; add approval/reversal events only if the state
machine uses them. Do not rely on `CHECKOUT.ORDER.COMPLETED`, which PayPal lists
for marketplaces/platforms.

The endpoint must:

- use the raw event body/required PayPal transmission headers and the configured
  webhook ID to verify authenticity using PayPal's supported verification flow;
- reject or quarantine unverified messages without mutating orders;
- store each event ID under a unique constraint before processing so duplicate
  deliveries are harmless;
- handle duplicates and out-of-order events with monotonic, validated state
  transitions;
- correlate the event to the expected live app, merchant, order, capture,
  currency, and amount;
- acknowledge only after durable receipt; process asynchronously when useful;
- retry internal work safely and alert on repeated failures or a delivery gap.

PayPal retries non-2xx webhook deliveries, so handlers must be idempotent. A
verified webhook is an input to the state machine, not permission to skip amount
and merchant checks.

### 3.5 Inventory, tax, shipping, and fulfillment

The current scaffold has no real-time inventory reservation and charges item
prices only. Before launch, choose and implement one coherent model:

- reserve stock transactionally when the order is created and expire abandoned
  reservations; or
- perform an authoritative availability check immediately before capture and
  define how a paid-but-unavailable exception is resolved.

Tax and shipping must be calculated and disclosed by the approved backend flow,
or the site must clearly state an approved alternative before payment. Never add
an undisclosed charge later. Record the promised ship-by basis and the actual
shipment/delay notices. The FTC's mail/internet order guidance covers shipment
promises, delay consent, cancellations, and prompt refunds for many online goods
orders; counsel must determine how it applies to DTC's customers and products.

---

## 4. Security and privacy baseline

### Credentials and environment separation

- Use different sandbox and live apps, databases, webhooks, logs, and config.
- Keep secrets in the host's managed secret store. Limit who and what can read
  them; enable MFA on PayPal and hosting administration.
- Rotate secrets on an approved schedule and immediately after suspected
  exposure. Test rotation, revoke the old secret, and record who performed it.
- Validate `PAYPAL_ENV`; never infer live mode from a client-supplied value.
- Log secret access and production configuration changes.

### API and application controls

- HTTPS only. Allow only explicit production origins; reject `null` and unknown
  Origin values on browser POSTs while still validating all direct API calls.
- Use strict request schemas, body/line/quantity/value limits, safe integer
  arithmetic, and normalized SKU matching.
- Put distributed rate limits/abuse controls in front of every public endpoint;
  in-memory limits are insufficient for multiple instances or restarts.
- Set explicit upstream connect/read timeouts, bounded retries with jitter, and a
  circuit breaker or degraded mode that stops new orders safely.
- Do not expose framework fingerprints, raw PayPal responses, payer/shipping PII,
  secrets, access tokens, authorization headers, or stack traces in logs.
- Sanitize log fields, restrict access, define retention, and test that error
  paths do not leak personal data.
- Protect operator tools with strong authentication, least privilege, MFA,
  CSRF protection where sessions are used, and an audit log.

### Browser security headers

Prefer a host/CDN that can send HTTP response headers. A meta CSP on GitHub Pages
is a limited fallback: it cannot provide HSTS, `frame-ancestors`, COOP, or all
header-only protections. Before launch, test a report-only policy and then
enforce a policy that permits only DTC assets, the selected API origin,
Fontshare if retained, and the PayPal domains/components actually used.

At minimum, evaluate and test:

- `Content-Security-Policy` with `default-src 'self'`, narrow PayPal/API/font
  allowances, `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors`; use a
  nonce-capable host if moving inline code/styles away from `'unsafe-inline'`;
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`, which PayPal recommends
  for its web SDK;
- `Strict-Transport-Security` only after HTTPS and subdomain effects are verified;
- `X-Content-Type-Options: nosniff`, a restrictive `Referrer-Policy`, and an
  intentional `Permissions-Policy`;
- clickjacking protection for normal site pages without blocking PayPal's
  required outbound frames/popups.

Do not copy a CSP blindly. PayPal's SDK requirements can change and differ by
component. Validate the final header against the current PayPal CSP guidance and
all sandbox flows on desktop and mobile.

### Privacy

The current static cart stores `dtc.cart.v1` in local storage with SKU and
quantity only. When checkout is enabled, PayPal acts as an independent data
controller for payment data and DTC will receive/persist limited transaction,
contact, shipping, and order information. The effective privacy notice must say
this accurately, link to PayPal's privacy statement, identify other processors,
state retention and rights practices, and match the implemented system.

No policy should claim absolute security. Collect only what operations actually
need, restrict access, delete on schedule, and maintain a tested breach-response
process with jurisdiction-specific notification review.

---

## 5. Dependency and deployment requirements

1. Pin the supported production major in `server/package.json` and the host
   runtime (prefer Node 24 LTS at this guide's date).
2. Generate and review `server/package-lock.json` with the approved npm version;
   commit it. Dependency changes require code review.
3. CI/deploy uses `npm ci`, not a mutable `npm install`.
4. Run lint/static checks, unit/integration tests, and `npm audit --omit=dev`.
   Review findings in context and patch deliberately.
5. Build one immutable artifact and promote the same artifact through staging to
   production. Do not build production from an unreviewed branch.
6. Run as a non-root user with a read-only filesystem where practical. Limit
   outbound network access to PayPal and required services.
7. Keep the API and database private from unnecessary network exposure; require
   TLS to the database and test encrypted backups/restores.
8. Provide `/api/health` for liveness and a separate readiness check that does
   not expose credentials, catalog contents, dependency versions, or PII.
9. Define zero/low-downtime migration and rollback procedures. Database schema
   must remain compatible during rollback.

### Proposed environment contract

Names may be adjusted for the selected platform, but required values should be
explicit and validated at boot:

```text
NODE_ENV=production
PAYPAL_ENV=sandbox|live
PAYPAL_CLIENT_ID=<secret-store reference>
PAYPAL_CLIENT_SECRET=<secret-store reference>
PAYPAL_WEBHOOK_ID=<secret-store reference>
PAYPAL_EXPECTED_MERCHANT_ID=<validated live merchant id>
DATABASE_URL=<secret-store reference>
ALLOWED_ORIGINS=https://2h5.github.io
TRUST_PROXY=<exact host-specific value>
LOG_LEVEL=info
CHECKOUT_CREATE_ENABLED=false
```

The included server currently accepts only `disabled` or `sandbox`; it rejects
`live` at startup because no production database adapter has been selected.
`ORDER_DATA_DIR` configures only the single-instance sandbox JSON store.

`CHECKOUT_CREATE_ENABLED` is the emergency/launch gate. Disabling it must not
disable health checks, webhook receipt, reconciliation, existing-order lookups,
or authorized refunds.

---

## 6. Verification matrix

Automate deterministic backend behavior with mocked PayPal responses, then run
the real PayPal sandbox suite. Tests must use the same database engine and proxy
assumptions as production.

### Unit and API integration tests

- [ ] Valid single/multi-line carts; integer totals and currency.
- [ ] Unknown, unavailable and duplicate SKUs; zero, negative, fractional,
      string, huge, and overflowing quantities; unknown JSON fields.
- [ ] Malformed/non-JSON/oversized bodies; wrong methods/content types.
- [ ] Missing/unknown/`null` origins and correct CORS/preflight behavior.
- [ ] Catalog/display drift fails safely; price/availability changes between
      create and capture are handled by the approved rule.
- [ ] Foreign PayPal order, wrong merchant/payee, wrong amount/currency/items,
      unapproved state, missing capture, partial/pending/denied capture.
- [ ] Repeated and concurrent create/capture requests cause one logical order
      and at most one capture/fulfillment action.
- [ ] Network timeout/5xx after PayPal capture retries with the same idempotency
      key and resolves without a second charge.
- [ ] Unresolved capture becomes `CAPTURE_UNKNOWN`; a restart and scheduled
      reconciliation resolve it without customer resubmission.
- [ ] Valid, invalid, duplicate, delayed, and out-of-order webhook events;
      webhook/API race; database failure before and after durable receipt.
- [ ] Refund, partial refund, reversal, dispute/denial, and refund failure update
      state idempotently.
- [ ] Rate limits work across instances; trusted proxy configuration cannot be
      spoofed to bypass limits.
- [ ] Logs and client errors contain no secrets, access tokens, payer/shipping
      details, raw upstream bodies, or stack traces.
- [ ] Database constraints, migrations, backup, and restore are exercised.

### PayPal sandbox and browser tests

- [ ] Cart add/change/remove/persistence and cross-tab update.
- [ ] Successful PayPal-wallet checkout has the exact approved SKU, amount,
      currency, merchant, DTC order reference, and one fulfillment record.
- [ ] Buyer cancellation leaves an unpaid, expirable order and does not clear the
      cart.
- [ ] `INSTRUMENT_DECLINED` and other supported negative tests allow the buyer to
      choose another funding source without creating a duplicate charge.
- [ ] Double clicks, refresh/back, two tabs, slow network, offline transition,
      popup blocking, SDK load failure, API 429/5xx, and backend restart.
- [ ] Capture response is deliberately dropped after success; UI shows
      “confirming,” same-order reconciliation completes, and no second payment is
      requested.
- [ ] Pending, denied, completed, refunded, partially refunded, and reversed
      webhooks reach the operator view and notification path.
- [ ] Invalid webhook signatures and events from the wrong app/merchant cause no
      order mutation.
- [ ] Final CSP/COOP/headers work with PayPal on supported desktop/mobile
      browsers, keyboard navigation, zoom, reduced motion, and screen readers.
- [ ] Policy links are visible, accurate, versioned, and usable before payment.

### Controlled live validation

Only after sandbox sign-off:

1. Deploy production with order creation disabled and no purchasable SKU.
2. Verify TLS, headers, secrets, database migrations/backups, monitoring,
   webhook reachability, and rollback.
3. Approve one low-risk internal test SKU/amount and temporarily enable it.
4. Complete one authorized real transaction, verify every record/notification,
   issue a full refund, and confirm the refund through webhook and PayPal.
5. Disable creation, review logs/reconciliation/data handling, obtain final
   business sign-off, then schedule a monitored launch window.

Never use a real customer's payment as the first live test.

---

## 7. Operations and incident runbooks

Assign a named primary and backup owner for every runbook. Each must include
access paths, decision authority, customer wording, escalation contacts, audit
steps, and a post-incident review.

### Ambiguous capture

1. Disable repeat submission for the affected order; do not create a replacement
   PayPal order.
2. Retry capture with the original `PayPal-Request-Id` if within the supported
   window, then GET the order/capture and check verified webhook state.
3. Keep `CAPTURE_UNKNOWN` until authoritative evidence resolves it. Tell the
   customer not to pay again and give the DTC order reference.
4. Escalate on an age threshold. Fulfill only after `PAID`; refund only after a
   capture is positively identified.

### Daily reconciliation

- Compare all created/approved/pending/unknown orders and recent captures,
  refunds, denials, and reversals against PayPal.
- Alert on missing webhooks, amount/merchant mismatch, stuck states, duplicate
  records, unlinked captures, refund failures, and paid orders without
  fulfillment acknowledgement.
- Record operator resolution; never “fix” state by deleting history.

### Refund/cancellation

- Verify the requester and approved policy/authority.
- Lock the order, use a stable refund idempotency key, persist the attempt, and
  handle ambiguous refund outcomes like captures.
- Do not promise completion until PayPal confirms it. Notify the customer with a
  reference and reconcile webhook/final status.

### Credential or data incident

- Disable new order creation while preserving webhook/reconciliation access.
- Revoke/rotate affected secrets, review access and sanitized logs, contain the
  affected systems, preserve evidence, and involve the incident owner/counsel.
- Determine applicable notice obligations based on facts and jurisdiction; do
  not make unsupported assurances.

### Price, inventory, or policy error

- Immediately make affected SKUs non-purchasable and stop new order creation if
  scope is uncertain.
- Identify affected unpaid/paid/fulfilled orders, preserve the advertised and
  accepted policy/catalog versions, and route resolutions to authorized business
  staff and counsel. Never silently substitute a price or product.

### Shipment delay or loss

- Preserve the promised ship date, carrier/insurance data, customer notices, and
  responses.
- Follow the approved delay/cancellation/refund policy and applicable law. The
  seller remains responsible for compliant customer communication even when a
  third party fulfills or transports the order.

---

## 8. Go-live checklist and sign-off record

### Business and legal

- [ ] Authorized catalog/prices/conditions/stock/lead times approved: ______
- [ ] Tax owner/adviser approval and implementation verified: ______
- [ ] Shipping/duties/title/risk/delay process approved: ______
- [ ] Return/refund/cancellation/restocking/warranty approved: ______
- [ ] Terms/privacy and checkout disclosures approved by counsel: ______
- [ ] Privacy retention/rights/vendor list/incident duties approved: ______
- [ ] Support, fulfillment, finance, and security owners trained: ______

### Engineering and security

- [ ] Supported Node LTS pinned; lockfile committed; `npm ci` used
- [ ] CI tests/audit pass and deployment artifact is immutable
- [ ] Durable database, constraints, migrations, backup/restore pass
- [ ] Create/capture idempotency and unknown-outcome reconciliation pass
- [ ] Signed webhook duplicate/out-of-order tests pass
- [ ] Live merchant/amount/currency/payee validation pass
- [ ] Shared rate limit, timeouts, safe errors, and PII-redacted logs pass
- [ ] TLS/CSP/COOP/security headers and browser accessibility pass
- [ ] Secrets/MFA/access/rotation and emergency disable switch verified
- [ ] Dashboards, alerts, reconciliation, and all runbooks exercised

### Release

- [ ] Sandbox evidence reviewed by: ______  Date: ______
- [ ] Controlled live transaction/refund reviewed by: ______  Date: ______
- [ ] Business go-live approval: ______  Date: ______
- [ ] Engineering/security approval: ______  Date: ______
- [ ] Counsel/policy approval: ______  Date: ______
- [ ] Launch window and rollback owner: ______

Filling in `commerce-config.js` is the final activation step, not the definition
of readiness.

---

## 9. Primary references

- DTC's currently published [Terms of Service](https://directturbinecontrols.com/terms-of-service/)
  and [Privacy Policy](https://directturbinecontrols.com/privacy-policy/) are the
  source baseline for the corresponding local pages; commerce additions still
  require DTC and counsel review.
- PayPal, [Idempotency](https://developer.paypal.com/api/rest/reference/idempotency/)
  and [REST API responses](https://developer.paypal.com/api/rest/responses/)
- PayPal Orders v2, [Capture payment for order](https://developer.paypal.com/docs/api/orders/sdk/v2/)
- PayPal, [Webhooks overview](https://developer.paypal.com/api/rest/webhooks/)
  and [checkout webhook subscriptions](https://developer.paypal.com/payment-methods/webhooks)
- PayPal Web SDK v6, [upgrade/integration guide](https://developer.paypal.com/v5-v6)
  and [Content Security Policy and COOP guidance](https://developer.paypal.com/sdk/js/csp/)
- PayPal, [Data Protection Addendum for Payment Processing Products](https://www.paypal.com/us/legalhub/paypal/data-protection)
  and [Privacy Statement](https://www.paypal.com/us/legalhub/paypal/privacy-full)
- Node.js, [release status](https://nodejs.org/en/about/previous-releases)
  and [end-of-life risks](https://nodejs.org/en/about/eol)
- npm, [`npm ci`](https://docs.npmjs.com/cli/commands/npm-ci/)
  and [`npm audit`](https://docs.npmjs.com/cli/commands/npm-audit/)
- OWASP, [HTTP Security Response Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
  and [Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- FTC, [Privacy and Security for Businesses](https://www.ftc.gov/business-guidance/privacy-security)
  and [Mail, Internet, or Telephone Order Merchandise Rule guide](https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule)

Re-check all external guidance when a host, PayPal product, jurisdiction, or
launch date is chosen; vendor and legal requirements change.
