# Public core and private Cloud — repository contract

This repository (`tiroq/pocket-library-cloudflare`) is the **canonical public upstream** of reusable Pocket Library behavior.

| Component | Source of truth | Consumed by |
|---|---|---|
| EPUB parsing, deduplication, OPDS feed serialization, device/cover support | This public repository | Standalone Worker + private Cloud |
| X3 dashboard input model, 528×792 bitmap layout/rendering, fonts, demo fixtures | This public repository | Standalone Worker + private Cloud |
| Basic manual/scripted JSON source contract, CrossPoint compatibility fixtures | This public repository | Standalone Worker + private Cloud |
| Users, identity, browser session, tenant-scoped D1, tokens, quota plans and subscriptions | Private `tiroq/pocket-library-cloud` | Hosted Cloud only |
| OAuth Google Calendar/Tasks connections, KOSync hosting, private web console/admin | Private `tiroq/pocket-library-cloud` | Hosted Cloud only |
| Cloudflare environments, IaC, deployment policy, monitoring | Private `tiroq/pocket-library-infra` | Hosted Cloud only |

## Architectural rule

The dependency direction is **Private Cloud → Public Core**, never the reverse. A change to the renderer, parser or OPDS serialization must land in the public repository first, and Cloud must adopt a versioned reference. No copying private source files into the public project.

**Current migration status:** A complete Git-history import of this public repository into the new private repository is a one-time bootstrap. Until it is verified, the private Cloud roadmap is documentation-only; do not regard an unrelated file-copy snapshot as a history-preserving migration.

## Extraction plan

1. Keep the existing standalone entrypoint and device routes stable: `/opds.xml`, `/books/:id.epub`, `/api/dashboard`, `/dashboard-1bit.bmp`, demo endpoints.
2. Move side-effect-free EPUB/OPDS and bitmap primitives into a framework-independent `packages/core/` workspace or a dedicated package once compatibility tests cover them.
3. Publish an explicit public `@pocket-library/core` API with semantic versioning and pin it by release/tag/SHA from the private repository. Choose the actual distribution mechanism based on build simplicity for Cloudflare Workers.
4. Keep all per-user storage, secrets, sessions, request authorization and quota mutation outside the public core library. Rendering should accept validated data/settings and return output bytes; it must not read shared production R2 paths itself.
5. Run public fixtures in Cloud CI to detect divergence. Changes to community logic must not require a private module to build or test.

## What is not a public requirement

The Free/Premium **hosted account tiers** (such as a configurable 10/day image refresh entitlement and 10 MiB per Free user) belong to the private Cloud platform. They are not default restrictions of the open standalone Worker.

## Safety

- Source `wrangler.jsonc` currently names a real personal domain and R2 bucket; **do not deploy an imported copy** without deliberately replacing those bindings.
- Existing tokens remain private Worker Secrets; never add credentials or user content to source or fixtures.
- No automatic production release is implied by changes to these repositories.

Roadmap for shared-core extraction: [Issue #16](https://github.com/tiroq/pocket-library-cloudflare/issues/16).
