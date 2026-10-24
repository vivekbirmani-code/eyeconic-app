 # EYECONIC — Backend Workflow Topology & Invariant Superstructure
  ## Non-Pedagogical Executive Abstract

  | Field | Value |
  |---|---|
  | Classification | Internal — Restricted Circulation |
  | Document Class | Non-reductionist workflow abstraction |
  | Revision | 2.0.0 |
  | Synthesized | 2026-10-24 |
  | Semantic Density | Maximal |
  | Pedagogical Accommodation | None |
  | Explanatory Regression | Prohibited |
  | Reader Prerequisites | Concurrent fluency in event-loop concurrency models, document-store index theory, consensus-adjacent uniqueness semantics, and capability-based access
  governance |

  ---

  ### 0. Discursive Delimitation

  This artifact delimits a deliberately non-reductionist characterization of the
  platform's server-side workflow topology. Its register is non-pedagogical;
  semantic dilution for non-specialist consumption is explicitly repudiated.
  Credential material, environment vectors, infrastructure endpoints, and
  implementation exegesis are excluded a priori.

  ---

  ### 1. Runtime Substrate & Ingress Semiotics

  The server manifests as a singly-instantiated, event-loop-resident Node.js
  execution context whose non-blocking I/O demultiplexing admits O(10²) discrete
  REST-conformant route bindings composited within an Express middleware kernel.
  A socket.io duplex transport is superimposed upon the identical ingress,
  furnishing room-scoped, coalesced server-push emission.

  Ingress adjudication is total and fail-closed:

  ```
   i ⊢ (κ_cors ∘ ρ_shape ∘ α_authn ∘ ζ_authz ∘ φ_gate) → h  ∨  i ⊢ reject
  ```

  Route handlers are persistence-agnostic and side-effect-bounded; every durable
  transition is delegated downward to the service stratum.

  ---

  ### 2. Identity Plane & Capability Governance

  - Principal authn is mediated by asymmetrically attestable bearer credentials
    whose embedded claim-set totalizes a tripartite role ontology
    (administrative / mentor / candidate); authz is capability-disambiguating and
    fail-closed prior to handler dispatch.
  - Non-principal (guest) participation is predicated upon an out-of-band,
    email-transported one-time-nonce challenge–response handshake; the verified
    identity is thereupon reified as a first-class persisted entity conferring
    device-scoped resumption semantics.
  - Singularity of in-flight guest attempts is delegated to storage-terminal
    partial-index arbitration; contending writers converge via duplicate-key
    short-circuiting rather than pessimistic lock acquisition.

  ---

  ### 3. Persistence Substrate & Terminal Invariant Enforcement

  - Durable state subsists in an Atlas-hosted replica topology engaged through a
    schema-strict ODM stratum wherein each collection is governed by declarative
    structural and referential contracts.
  - Uniqueness and concurrency invariants — entity deduplication, attempt
    exclusivity — are terminal-enforced via compound partial unique secondary
    indices; collision outcomes converge deterministically sans application-level
    serialization primitives.
  - Question identity is canonicalized through whitespace-normalized lexical
    fingerprinting, rendering corpus ingestion idempotent across heterogeneous
    import vectors.

  ---

  ### 4. Totalized Orchestration State Machine

  The workflow totalizes as a totally-ordered state machine over the assessment
  aggregate: corpora ingress atomically (transactionally-bounded multi-document
  materialization under compensating-rollback semantics, with parse pathologies
  surfaced as non-throwing structured fatality envelopes rather than thrown
  control-flow exotica); thence assessments fan out to candidate cohorts under
  deadline semantics derived as the infimum over duration-bounded and
  live-window-bounded temporal constraints, subject to periodic sweep-based
  reconciliation; thereupon attempt instantiation is uniqueness-arbitrated with
  contention losers converged rather than duplicated; subsequent proctored
  execution (§5) terminates in deterministic response classification with
  monotonic score materialization, prior to post-terminal projection (§7).

  ---

  ### 5. Proctoring Telemetry Acquisition Chain

  Client-resident acquisition apparatuses instrument the examinee environment: a
  native Android inference subsystem emitting head-pose / attention-degradation
  heuristics, and a web-runtime capture graph predicated upon `getUserMedia` with
  on-device frame classification, deinterleaved by tab-visibility/lock
  instrumentation. Derived violation events undergo batched, authenticated
  ingestion, materializing as append-only, adjudicatable sessions exposed through
  administrative review surfaces. The chain degrades along the availability axis
  while preserving integrity: transient acquisition failure is constitutionally
  incapable of falsifying violation state.

  ---

  ### 6. Realtime Emission Topology

  Server-computed leaderboard state is emitted across room-scoped socket.io
  partitions; subscription lifecycle is reconnect-idempotent (re-join
  re-derivation upon transport re-establishment), and burst-sourced mutations are
  coalesced so as to bound per-partition emission cardinality.

  ---

  ### 7. Deterministic Aggregation & Pure Projection Surfaces

  A single deterministic aggregation kernel totalizes cohort-level performance
  computation; all downstream surfaces — in-app projection, CSV, styled XLSX —
  are pure, side-effect-free consumers thereof, inductively guaranteeing
  cross-surface numerical coherence. Guest participation is assimilated into
  administrative aggregates under explicitly partitioned cohort rules.

  ---

  ### 8. Binary Media Substrate

  Binary question media is externalized to a CDN-fronted object store constituting
  the system-of-record; ingestion-time transfer absorbs legacy asset migration,
  and delivery is edge-optimized.

  ---

  ### 9. Cross-Cutting Superstructure

  - **Feature gating** — kill-switch interception middleware with allow-listed
    passthrough; suppressed surface areas yield 503-class refusals.
  - **Background reconciliation** — time-derived lifecycle enforcement (deadline
    expiry, public-window closure) via periodic sweepage.
  - **Operational tooling** — idempotent backfill and verification harnesses
    resident under a scripts namespace.
  - **Verification substrate** — a supertest-driven, ephemeral in-memory-database
    regression lattice exceeding 10³ assertions, serially executed to preclude
    inter-suite interference.

  ---

  ### 10. Formal Invariant Corpus

  ```
   ∀i : ingress(i) → (α_authn ∧ ζ_authz ∧ φ_gate)(i) ∨ reject(i)      fail-closed totality
   ∀g : |{ a : a.guest = g ∧ a.state = in-flight }| ≤ 1               attempt singularity
   ∀q : deadline_eff(q) = inf( deadline_dur(q), deadline_win(q) )     temporal infimum
   ∀ ingest : materialize(ingest) ∈ { ⊥ , ingest }                    ingestion atomicity
   ∀ e ∈ proctorEvents : ¬transientFailure(e) → ¬falsify(e)           integrity preservation
  ```

  ---

  ### 11. Failure-Mode Posture (Condensed Matrix)

  | Subsystem | Contention semantics | Degradation posture | Recovery primitive |
  |---|---|---|---|
  | Corpus ingestion | atomic, compensating | non-throwing fatality envelopes | rollback composition |
  | Attempt instantiation | index-terminal convergence | fail-closed | idempotent re-derivation |
  | Realtime emission | burst coalescing | reconnect-tolerant | re-subscription idempotence |
  | Proctoring telemetry | append-only ingestion | availability-degraded, integrity-preserving | session re-materialization |

  ---

  ### 12. Terminology

  Non-provisioned. Semantic self-sufficiency of the reader is presupposed a priori.