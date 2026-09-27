# Security Policy

## Supported versions

Security fixes land on the latest minor release. Please upgrade before reporting.

| Version | Supported |
|---|---|
| 1.x (latest) | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report them privately through [GitHub Security Advisories](https://github.com/Pep3M/WACore/security/advisories/new). Include:

- what you found and how to reproduce it,
- the WACore version and how you run it,
- the impact you expect (for example: auth bypass, session or credential leak, webhook spoofing).

You'll get an answer within a few days. Once a fix is released, you'll be credited in the changelog unless you'd rather stay anonymous.

## Hardening checklist

WACore holds the credentials of a real WhatsApp account. Treat the deployment like one:

- Use a long random `API_KEY`. Without one, the API stays disabled.
- Don't expose the API port (`9878`) to the internet without a reverse proxy with TLS in front.
- Set `WEBHOOK_SECRET` and verify `X-WACore-Signature` on every webhook you receive.
- Protect the session store (`/data/sessions`, Redis or PostgreSQL): anyone with those credentials can act as your number.
- Pin a Docker image version (`ghcr.io/pep3m/wacore:vX.Y.Z`) instead of `latest` in production.
