## 2.741.0

### Added — a switch for "let the assistant decide, not your automations", on Act & Tell

2.740.0 added the setting and no control wrote it, so it could only be changed by editing the stored
document — an invisible flag that silently changes which checks run, which is what gets forgotten and
then misdiagnosed weeks later. It is now a switch on Act & Tell beside quiet hours and the actuable
devices, the same authority question one level up: those say what the villa may DO, this says who
decides what is worth SAYING. The setting also moved from the reports config into the agent config
where that tab already has a draft, since splitting one dialog across two stored documents for one
checkbox was the wrong seam. Its explanation says plainly that nothing is doubled up: a finding about
a device one of your automations reported is still dropped in favour of yours, per device.

