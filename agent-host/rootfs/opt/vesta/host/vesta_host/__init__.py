"""VESTA Agent host — the shell around the agent slot (docs/agent-host/SPEC.md).

Standard library plus PyYAML only: the host must never need the agent's
dependencies, and it knows the agent solely through its manifest and the
environment contract (SPEC H2).
"""
