"""VESTA's backend, arranged by dependency layer. TASK-115.

    shared     → nothing            pure; ships with any deployment
    adapters   → shared             the environment; one implementation each
    brief      → shared, adapters   the deterministic briefing (deletable)
    supervise  → shared, adapters   the agent + observation (exportable)
    host       → everything         wires them; the proxy

The model is specified in docs/refdata/architecture.py::LAYERS and ENFORCED by
tests/py/test_layering.py — the folders are the legibility, the test is the
boundary. Two futures shape it, both the owner's (2026-08-28): delete `brief`
wholesale once the agent supervises exclusively, and export `shared` +
`supervise` to run on an external resource with a swapped `adapters`.
"""
