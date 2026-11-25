# Specification Quality Checklist: Cluster Frames

**Purpose**: Validate specification completeness and quality before proceeding to planning

**Created**: 2026-11-25

**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
- No marker was needed. The choices that could have been one have a default
  stated in the spec: `request-freelens-proxy-certificate` is not answered by
  the core and no view of the Tauri build sends it (FR-019), because the Tauri
  build has no local TLS proxy and a search of the sources finds no reader of
  the value in the views; the frame record is limited to which clusters have a
  frame and which is visible (FR-016, FR-017), and sending the catalog on
  `cluster:set-frame-id` is left to main-catalog; isolation is by origin and by
  the core's refusals, without restricting channels by view, as spec 003
  clarified.
- The feature is a boundary inside the application, so the body names origins,
  browser storage, cookies and the three channels: the terms of the user input
  and of the channel list. It makes no implementation choice: no scheme,
  library, setting or file layout is named, and how the core knows a frame is
  left to the plan, within FR-008.
- FR-005 to FR-007 are security requirements the user input states only as
  "without sharing state": the core must not serve unknown hosts, must refuse
  what crosses origins, and must say which views may use each route, because
  cluster frames show content from clusters. `/speckit-clarify` may confirm or
  narrow them.
- Crash isolation between frames is out of scope (Assumptions): it depends on
  how the browser engine assigns processes, which R10 of spec 001 lists as
  unverified.
