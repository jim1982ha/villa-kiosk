# VESTA Agent (engine and starter skills)

The VESTA Agent, built by Fabien, packaged for the VESTA Agent host: the host's
image build installs this folder (`vesta-agent.yaml`) and its slot starts it.
Design and decisions: `docs/agent-host/INTEGRATION-PLAN.md` and `ZIP-CHANGES.md`
(local), from `vesta-addon_0.2.1`.

```text
vesta-agent.yaml        the manifest the host reads (install, start, stop grace, system packages)
requirements.txt
vesta_agent/            the engine: Home Assistant events, Telegram (send only), Kiosk, policy,
                        approvals, runner, scheduler, skills loader
vesta_shared/           the engine's library, also imported by the skills' scripts (read-only
                        HA MCP client, store, knowledge pack)
starter/skills/         the five skills, copied ONCE to VESTA_SKILLS_DIR on the first start
starter/config/         policy.yaml (empty) and instructions.md, copied to VESTA_AGENT_CONFIG_DIR
tests/                  synthetic tests, run by CI; tests/villa/ (the villa's own data) is local only
```

Tests: `pip install -r requirements.txt pytest && python -m pytest tests -q`.
