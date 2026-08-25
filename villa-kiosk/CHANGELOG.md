## 2.740.0

### Changed — the agent can now own detection outright, and the villa remembers 14 days instead of 3

A blueprint retired but left installed suppressed its built-in replacement permanently:
`silent_blueprints` is installed-minus-ever-seen and that flag never decays, so such a rule is neither
absent nor silent and no waiting period released it. The new `agent_owns_analysis` setting (off by
default) makes a rule's mere presence stop deciding anything. The duplicate protection this looks like
it removes is untouched — findings are still deduplicated per device against what a blueprint reported
this period, so a rule that is speaking still wins on its own equipment. Separately the observation
journal now holds 105,000 entries rather than 20,000: measured at 7,322 rows/day the old bound was
2.84 days, and every salience baseline is built from that ring, so slow drift became the new normal.

