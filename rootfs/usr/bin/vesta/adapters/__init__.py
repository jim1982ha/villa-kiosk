"""The environment layer: disk, Home Assistant, notify, secrets, logging.

ONE implementation per deployment — an external agent (the export the owner
reserved, REQ-063) swaps THIS layer and nothing else. Imports only
vesta.shared; test_layering.py enforces it.

⚠️ DEGRADE, NEVER FAIL — carried over from the reports package these modules
grew up in: the kiosk is a wall tablet, and an adapter that raises where the
proxy can see it is a 3D dashboard down because a weekly summary failed.
Every entry point returns a degraded value or logs and swallows.
"""
