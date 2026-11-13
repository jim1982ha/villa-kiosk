"""A starter skill a villa edited is kept as it is by every update (vesta_agent.skills: EDITED), and runs on the
shared code of the release installed: every name a released starter skill imported from vesta_shared still imports,
or that skill stops at its first line. The list: every `from vesta_shared… import …` in the starter skills of every
release (git history to 0.12.511), but three names retired weeks before (asleep.without_sleep in 0.12.319,
page._nice in 0.12.267, problems.help_key in 0.12.410)."""
from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone

import pytest

IMPORTED = {
    "vesta_shared": ["agent_records", "agreement", "alert_watch", "asleep", "automation_words", "battery", "daily",
                     "demand", "kiosk_words", "message_format", "occupancy", "page", "past", "periods", "restart",
                     "result", "retention", "run_hours", "script", "skill_settings", "status_words", "visit_state"],
    "vesta_shared.asleep": ["awake_states", "last_value", "read_states", "unheard"],
    "vesta_shared.axis": ["is_flat", "label", "nice_axis"],
    "vesta_shared.critical": ["run_when"],
    "vesta_shared.daily": ["energy_daily_features", "power_daily_features"],
    "vesta_shared.device_state": ["ABSENT", "ANSWERS", "ASLEEP_NOW", "NO_VALUE", "NO_VALUE_NOW", "OFFLINE",
                                  "OFFLINE_NOW", "RestartDrops", "battery_charge", "ha_restarts", "has_value",
                                  "in_restart", "is_offline", "out_for", "out_of", "out_since", "reading", "settling"],
    "vesta_shared.energy_setup": ["used"],
    "vesta_shared.ha_client": ["HAError", "McpClient", "client_from_args"],
    "vesta_shared.history_memory": ["remembered"],
    "vesta_shared.knowledge_pack": ["KnowledgePack", "device_key"],
    "vesta_shared.limits": ["limit"],
    "vesta_shared.maintenance": ["on", "takes_up"],
    "vesta_shared.message_format": ["PRESSED", "ROLE_SHORT", "STATUS", "TO_LONGEST", "acted", "closing", "document",
                                    "for_the_ai", "split_title", "status_line"],
    "vesta_shared.messaging": ["CITE", "TELEGRAM_CAPTION", "fmt_money", "incident_message", "incident_tag", "no_code",
                               "no_platform_name_in", "split_message", "uncited"],
    "vesta_shared.offline": ["device_answers", "devices_offline", "held_since", "reported_since", "watched_kinds"],
    "vesta_shared.page": ["H", "PAD_B", "PAD_L", "PAD_R", "PAD_T", "W", "_axis", "_framed", "_scale", "_ticks", "_tip",
                          "bars", "line", "linked", "number", "pairs", "say", "templates"],
    "vesta_shared.params": ["MissingParameter", "VillaParams", "live_params"],
    "vesta_shared.past": ["Logbook", "automation_run", "unread"],
    "vesta_shared.periods": ["did"],
    "vesta_shared.problems": ["AGAIN_DAYS", "CLOSED_IN_KIOSK", "DONE", "JUDGED_DAY", "NOT_A_PROBLEM", "Problems",
                              "STILL_THERE", "again_days", "again_title", "alert_line", "alert_name", "closes_tonight",
                              "incident_runs", "priority_of", "problem_name", "worsened"],
    "vesta_shared.restart": ["RestartDrops"],
    "vesta_shared.result": ["COUNTER_RESET", "FAULT_LOG", "NIGHT_CHECK", "PARAM_MISSING", "PRIORITY_ORDER",
                            "WHOLE_DEVICE", "fault_log", "fault_log_skipped"],
    "vesta_shared.retention": ["days_words"],
    "vesta_shared.skill_settings": ["behaviour", "load", "retired"],
    "vesta_shared.stats": ["med", "pct_change", "slope_per_hour", "step_index"],
    "vesta_shared.store": ["Incident", "Notes", "Store", "alerted_states", "notes_of", "watch_until"],
    "vesta_shared.timeutil": ["clock", "day_label", "day_time_label", "hhmm_to_minutes", "lasting", "local_day",
                              "moment_label", "month_label", "said", "schedule_hours_per_day", "villa_date",
                              "villa_day", "villa_time", "weekday_name"],
}


@pytest.mark.parametrize("module", sorted(IMPORTED))
def test_every_name_a_released_starter_skill_imports_still_imports(module):
    exec(f"from {module} import {', '.join(IMPORTED[module])}", {})


def test_the_restart_names_an_edited_night_check_still_calls_answer_as_before():
    from vesta_shared.device_state import RestartDrops, battery_charge, ha_restarts, in_restart, settling
    now = datetime(2026, 11, 13, 14, 49, tzinfo=timezone.utc)
    book = [{"domain": "homeassistant", "message": "stopped", "when": (now - timedelta(minutes=6)).isoformat()},
            {"domain": "homeassistant", "message": "started", "when": (now - timedelta(minutes=2)).isoformat()}]
    assert ha_restarts(book) == [now - timedelta(minutes=2)]
    assert settling(book, now, 5) and not settling(book, now + timedelta(minutes=5), 5)
    assert in_restart(now - timedelta(minutes=1), ha_restarts(book), 5)
    assert RestartDrops(book, 5).at_restart("switch.example", now - timedelta(minutes=3))
    assert callable(battery_charge)
    from vesta_shared.result import FAULT_LOG, NIGHT_CHECK, fault_log, fault_log_skipped
    assert fault_log([{"what": "closed"}], NIGHT_CHECK)[0]["check"] == NIGHT_CHECK and FAULT_LOG
    assert len(fault_log_skipped(NIGHT_CHECK)) == 1
    assert importlib.import_module("vesta_shared.problems").Problems.written   # an edited check's fault log
