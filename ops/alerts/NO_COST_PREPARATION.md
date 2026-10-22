# Zero-new-service-cost alert preparation

Status: review only. No account is created, service is enabled, mail is sent or
production setting is changed. SMTP is optional. The paid monitoring proposal has
been withdrawn under the owner's zero additional budget constraint.

## Proposed layers

1. Existing Tencent Cloud basic cloud-product monitoring and its managed email
   notifications cover supported infrastructure metrics. A checked notification
   channel is not proof that the intended mailbox is verified or receives mail.
2. UptimeRobot Free checks the public home page and health endpoint every five
   minutes and sends its own email alerts. This is a proposed slower interval,
   not the earlier one-minute or 3-failure/2-recovery contract. The account's exact
   confirmation/recovery behavior still needs acceptance. Use no paid features.
3. Healthchecks.io Hobbyist provides one external dead-man check and managed email.
   Proposed period 5 minutes plus grace 7 minutes means a missed check-in is due
   after 12 minutes, plus provider processing and email delivery. No SMTP account
   or separate monitoring server is needed. Enablement needs owner approval.

Official sources, checked 2026-10-22:

- [Tencent Cloud metrics overview](https://cloud.tencent.com/document/product/248/62458):
  cloud-product metrics are free; reporting/Agent requirements depend on product.
- [Lighthouse monitoring](https://cloud.tencent.com/document/product/1207/46856)
  and [notification channels](https://cloud.tencent.com/document/product/248/50410).
- [UptimeRobot Free](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan):
  50 monitors, 5-minute checks, no card required; confirm actual account limits.
- [Healthchecks pricing](https://healthchecks.io/pricing/): current Hobbyist
  plan is $0 for 20 jobs; the proposal needs one.
- [Healthchecks ping API](https://healthchecks.io/docs/http_api/) and
  [period/grace configuration](https://healthchecks.io/docs/configuring_checks/).

Tencent CAT has a 15-day trial followed by paid options; Tencent SES has a
one-time 1000-email allowance and automatic metered billing afterward. Neither
is a permanent no-charge sending/monitoring solution for this plan. Do not open
trials or enable metered services. See
[CAT billing](https://cloud.tencent.com/document/product/280/70804) and
[SES pricing](https://cloud.tencent.com/document/product/1288/47930).

## Hosted heartbeat contract

`alerts.py hosted` consumes the bridge's sanitized observation and one encrypted
credential named `heartbeat`. Its JSON contains only a `path` holding the
provider-assigned UUID path. This credential is a bearer capability for one
check, not a management API key. Do not paste it into chat, public configs or logs.

The implementation pins the production hostname to `hc-ping.com:443`, verifies
TLS, refuses redirects and requires the documented HTTP200/OK response. It sends
GET with no diagnostic body. A healthy new observation sends success; a degraded
observation uses `/fail`. Stale, future, malformed and replayed observations fail
closed. Recovery requires a newer observation. Provider acknowledgement does not
claim inbox delivery or SMTP health.

Attempt state is persisted before the request. A crash or failed acknowledgement
never retries the old sample after restart; the next fresh monitor sample may
retry. This conservative policy can omit one sample but cannot keep resetting
the hosted timer using the old one. Credential changes require reconciliation
while disabled. No unknown check is created and no `create=1` URL is permitted.

The proposed heartbeat unit is an alternative to the SMTP sender. Keep the
existing SMTP service disabled; choose the exact future units and pause/drain
inventory before any installation. The bridge and heartbeat both obey the
existing maintenance flag. The default egress rule remains loopback only;
approved DNS/HTTPS rules and real connectivity are still NOT RUN.

## Acceptance before enablement

- Verify free account features and absence of card, trial or automatic overage.
  Do not upgrade automatically if a feature is unavailable.
- Confirm the existing cloud instance, enabled policies, Agent/reporting coverage
  and the actual verified recipient. Prepare a separate email-only template if
  approved; do not change the existing SMS channel during inspection.
- Have the owner create/verify any new free accounts. Registration and recipient
  verification may send emails and are not executed by this preparation.
- Approve a finite maintenance plan. Free-tier features may require manual
  coordination; critical heartbeat/storage failures must remain visible, with
  explicit end and recovery checks. Do not promise paid maintenance features.
- Confirm remaining included server traffic. Small HTTPS check-ins consume some
  existing bandwidth; a zero service subscription is not a guarantee against all
  existing server traffic overage charges.
- Separately approve install, activation, real failure/recovery and inbox tests.
  No account creation, payment, provider API connection or real mail is done here.

Tests use real loopback TLS, fictional UUIDs and no network routes in Linux CI.
The native systemd fixture uses actual encrypted credentials and the original
CPU10%/64MiB/16-task limits. It does not contact any real provider.
