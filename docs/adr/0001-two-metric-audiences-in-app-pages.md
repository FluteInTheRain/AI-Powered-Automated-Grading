# 0001. Two metric audiences, both as in-app pages

Status: accepted, 2026-11-27 (T6.5)

## Context

Teachers need exam statistics; the developer needs to judge the AI system. Options: (A) teacher page in the app and the developer uses the Cloudflare dashboard only; (B) both pages in the app; (C) A first, developer page later.

## Decision

Option B (chosen by the author, 2026-11-27). The teacher page reads D1 only. The developer page (`/teacher/admin`) is gated by an `ADMIN_EMAILS` allowlist and reads Analytics Engine through its SQL API using a read-only token secret. The Worker runs a fixed set of queries; no user-typed SQL.

## Consequences

One extra secret (`CF_API_TOKEN`) and var (`CF_ACCOUNT_ID`). If the SQL API is down the page still shows the D1 parts and marks health "unavailable". Admin is an env allowlist, not a database role (simplest for one developer).
