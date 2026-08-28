"""The pure half of analysis: contracts, statistics, and the three modules.

⚠️ THE REGISTRY IS NOT HERE, AND THAT IS THE POINT. It gates, skips and runs —
briefing concerns — and it REGISTERS these modules itself (its
`_register_shipped`), which is the inversion that removed the one upward edge
this tree ever had: each module used to self-register at import, making pure
statistics depend on the deletable half for a two-line side effect.
"""
