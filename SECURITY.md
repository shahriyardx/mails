# Security policy

## Reporting a vulnerability

Please report security problems privately through
[GitHub security advisories](https://github.com/shahriyardx/mails/security/advisories/new).
Do not open a public issue.

Include what you found, how to reproduce it, and what an attacker could do
with it. You will get an answer within a few days. Once a fix is released,
the advisory is published and you are credited, unless you prefer not to be.

## Supported versions

Security fixes go into the latest release. Please update before reporting.

## Scope

In scope: the server, the dashboard, the Cloudflare Email Worker, the browser
extension and the Node SDK in this repository.

Out of scope: problems in Amazon SES, Cloudflare or GitHub themselves, and
setups that expose secrets on purpose (for example a public `.env`).
