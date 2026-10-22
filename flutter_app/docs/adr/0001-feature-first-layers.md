# ADR-0001: Feature-first with per-feature layers

**Status:** Accepted · **Date:** 2026-10-22

## Context

The app has 28 features and 178 Dart files. Before this decision, feature
internals were inconsistent: some had `providers/` + `services/` +
`widgets/` + `models/`, some were one big screen file, some mixed models
into providers. A new contributor had no rule for where a new thing goes.

## Decision

Every feature uses ONE internal layout, four folders:

```
features/<feature>/
├── domain/        # models + pure logic + abstract contracts (pure Dart)
├── data/          # services/repositories impl (relay/API/storage calls)
├── application/   # Riverpod providers/notifiers (state)
└── presentation/  # screens + feature widgets (Flutter UI only)
```

Small features may collapse `application` into `presentation`. Migration
mapping (mechanical, no behavior change): `models/` → `domain/`,
`services/` → `data/`, `providers/` → `application/`,
`widgets/` + screens → `presentation/`.

Global providers in `core/providers/` split by domain
(`nostr_service_providers.dart`, `auth_providers.dart`,
`content_providers.dart`) and are re-exported by the `app_providers.dart`
barrel so existing imports keep working.

## Consequences

- A new contributor can place any new file correctly by reading `AGENTS.md`.
- Dependency direction is one-way: presentation → application → data →
  domain. Domain never imports Flutter.
- Based on Andrea Bizzotto's Riverpod feature-first pattern, which Google's
  Compass sample mirrors.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Layer-first (`screens/`, `services/`, `models/` at top level) | Doesn't scale past ~10 features; files for one feature end up scattered across the tree. |
| VGV monorepo FFCA (package per feature layer) | Massive overhead for a single deployable app; only pays off for multi-app monorepos. |
