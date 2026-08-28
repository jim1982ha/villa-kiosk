"""The pure layer: no I/O, no HA, no disk, no environment. TASK-115.

⚠️ PURITY IS PINNED, NOT INTENDED — test_layering.py refuses open(),
HassClient, ClientSession, DATA_DIR and os.environ anywhere under this
package. That is what keeps the exportable set exportable: a shared module
that opened a file would carry the add-on's environment with it, and the
export would become a port instead of a deployment.
"""
