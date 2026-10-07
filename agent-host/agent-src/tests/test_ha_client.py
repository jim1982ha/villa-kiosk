

def test_the_agents_stream_reader_reads_the_hosts_samples():
    # architecture review 7: one set of samples for both readers (agent-host/tests/sse_samples.py)
    import importlib.util
    import json
    import os
    from helpers import ROOT
    from vesta_shared.ha_client import _sse_last_data
    spec = importlib.util.spec_from_file_location("sse_samples", os.path.join(ROOT, "..", "tests", "sse_samples.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for raw, want in mod.SAMPLES:
        assert json.loads(_sse_last_data(raw)) == want
