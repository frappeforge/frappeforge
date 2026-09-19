# Security policy

## Supported versions

Security fixes are released for the **latest published version** of every package in this
repository:

| Package                | Supported    |
| ---------------------- | ------------ |
| `@frappeforge/client`  | latest minor |
| `@frappeforge/codegen` | latest minor |

Older releases receive fixes only when a maintainer explicitly marks a release line as
supported in its changelog.

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security report.**

Use GitHub's private vulnerability reporting:
<https://github.com/frappeforge/frappeforge/security/advisories/new>

Please include:

- the affected package and version,
- the impact — what an attacker can achieve,
- reproduction steps or a proof of concept,
- any workaround you are aware of.

## What to expect

- Acknowledgement within **7 days**.
- A fix or mitigation plan within **30 days** for confirmed issues; faster for critical ones.
- Coordinated disclosure: we ask that you keep the report private until a fix is published
  or **90 days** have passed, whichever comes first. We credit reporters in the advisory
  unless they prefer otherwise.

## Scope

This policy covers code published from this repository to npm under the `@frappeforge`
scope. Vulnerabilities in Frappe Framework or ERPNext themselves should be reported to
Frappe Technologies through their own security process.
