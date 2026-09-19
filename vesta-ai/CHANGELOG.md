## 0.1.0

The first release of the VESTA AI Layer: it installs, starts, connects, and
reports what is true about itself. It does nothing else on purpose — there are
no alerts, no reports and no model behind it yet.

What it does do is lay the two things everything after it is built on. The first
is the seam: the layer is constructed with a `World` carrying four ports — Home
Assistant, a channel to reach a person, a model, and a clock — and reaches
around none of them, so every later feature can be tested against a fake
property instead of a live one. The channel and the model are stubs in this
release and both REFUSE when called rather than answering emptily, because a
component that answers as data about an empty world cannot be seen to be
unwired.

The second is the token meter, and it ships before anything can spend a cent. It
counts input, cached and output tokens and a running cost for every model call,
and this release reads zero because nothing calls a model. Its printed line is
the only cost figure this project may quote: a planning document once carried a
$5.00/day number that was read as live against $0.043 actually measured, and the
rule that came out of that is that a cost claim is a measurement or it is not
made. A model the price table does not know is reported as UNPRICED and closes
the daily budget, never as free.

It reaches Home Assistant two ways, and says so separately. Everything it asks
goes through the ha-mcp add-on, whose address and secret you paste on the
Configuration page. One direct connection does only the two things ha-mcp
structurally cannot: it subscribes to state changes and listens, and it
publishes this add-on's own health entity. Those two connections fail
independently — the gateway can be down while events still arrive — so the
health entity reports each of them on its own, and a half-working layer reads
`degraded` rather than `ok`.
