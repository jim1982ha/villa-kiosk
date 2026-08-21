## 2.561.0

### Fixed — tapping a fault in the Cockpit opened the device, not the fault

The "needs attention" list mixes devices with maintenance records, and every row
opened a device panel — so an open fault opened whatever equipment it names
instead of the ticket. A fault now opens in Facility with its details ready to
edit, and an overdue maintenance job opens the Schedule tab. Rows that stand for
a device still open the device, which is what they are for.

