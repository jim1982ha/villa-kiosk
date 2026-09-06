"""Reading code and asserting on it must not read the PROSE around it.

A pin that spells a call in a substring is how this suite holds a cross-artefact
contract no type checker can see. It has one failure mode, and the suite hit it
four times before this file existed: the needle matches inside a COMMENT or a
DOCSTRING. Each time the assertion measured prose — passing because a remark
mentioned the identifier, or failing because a remark explained the history of
the very thing it forbids. The last one failed a correct change because a
comment quoted the literal it bans.

⚠️ IT IS FIXED BY A TOOL, NOT BY REMEMBERING. `conftest.code_of(obj)` returns a
function's source with comments and docstrings blanked IN PLACE — every other
character keeps its column, so an existing pin that spells a call the way a
human writes it still matches. `strip_prose(text)` does the same for text
already in hand.

⚠️ SIX FILES HAD ALREADY NOTICED AND EACH INVENTED THE SAME WRONG FIX:
`re.sub(r"#[^\n]*", "", ...)`. That regex leaves DOCSTRINGS — where this
codebase keeps most of its prose — and eats any `#` inside a string literal. So
the trap survived in precisely the places that had seen it. Those six now call
the shared helper and the regex is banned below.
"""

from __future__ import annotations

import ast
import os
from typing import Dict, List, Set

from conftest import strip_prose

HERE = os.path.dirname(os.path.abspath(__file__))


def _code(name: str) -> str:
    """⚠️ THIS FILE MUST NOT MEASURE PROSE EITHER, AND ITS FIRST VERSION DID.
    Every check below scans the suite for a pattern, and this file DESCRIBES
    those patterns — so it matched itself and failed the moment it was written.
    A detector that cannot be pointed at its own subject is not a detector."""
    with open(os.path.join(HERE, name), encoding="utf-8") as handle:
        return strip_prose(handle.read())

#: Files that read source WITHOUT stripping prose, frozen on 2026-09-06.
#:
#: ⚠️ A BACKLOG, NOT AN EXEMPTION. Every entry is a file whose pins can still
#: match a comment; the freeze exists so no NEW one joins them, and so the list
#: can only shrink. Converting one means deleting its line — and a line that no
#: longer describes a file fails the rot test below, so the list cannot become
#: a record of things that were once true.
#: Files with their own `.tsx` comment stripper, frozen on 2026-09-06.
#:
#: ⚠️ FOURTEEN, NOT TWO. The review found the two that a candidate named; the
#: guard found twelve more. That is what a missing shared tool costs — and
#: `test_module_conventions`' own copy carries the history: "three of eight
#: /dry-audit hits on 2026-08-19 were exactly this mistake".
#:
#: ⚠️ A BACKLOG, NOT AN EXEMPTION, and frozen rather than mass-converted
#: because two bulk edits over these files went wrong the same day: a regex
#: anchored on `sys.path.insert(` matched the first line of a MULTI-LINE call
#: and inserted an import into the middle of it. The list can only shrink.
KNOWN_OWN_TSX_STRIPPER: Set[str] = {
    "test_agent_queue_bulk.py",
    "test_cockpit_reach.py",
    "test_css_classes.py",
    "test_dedupe.py",
    "test_editable_rows.py",
    "test_flag_type_wire.py",
    "test_people.py",
    "test_review_surface.py",
    "test_route_has_a_client.py",
    "test_section_rhythm.py",
    "test_store_envelope.py",
    "test_verification_sweep.py",
}

#: Every raw `inspect.getsource` site, frozen as `file.py:line`.
#:
#: ⚠️ SITES, NOT FILES (2.956.0). This froze 37 FILENAMES, and the detector
#: exempted a whole file for one mention of `strip_prose` — so 107 raw sites
#: across 57 files reported as 37. One of the hidden ones was
#: `test_task_loop.py`'s ordering pin, which matched a COMMENT and passed with
#: the rule it guards reversed, with the whole suite green.
#:
#: ⚠️ THIS LIST MUST ONLY SHRINK. `test_the_frozen_list_does_not_rot` fails on a
#: stale entry, so converting a pin to `code_of` forces its entry out.
#:
#: ⚠️ KEYED ON THE ENCLOSING FUNCTION, NOT THE LINE. Line numbers were the
#: first key and they churned: any edit to a file shifted its own entries, so
#: an unrelated change made this "only shrinks" list rewrite itself. A function
#: name survives edits above it and still names exactly one site.
KNOWN_RAW: Set[str] = {
    'test_act_availability.py::test_clearing_an_alert_does_not_claim_to_silence_its_kind',
    'test_agent_act.py::test_it_carries_no_policy_of_its_own',
    'test_agent_act_allowlist.py::test_investigate_BUILDS_the_actuator_when_the_policy_allows_it',
    'test_agent_budget.py::test_the_breaker_is_deliberately_NOT_persisted',
    'test_agent_chat.py::_imported_names',
    'test_agent_chat.py::test_nothing_in_this_module_writes_to_disk',
    'test_agent_chat.py::test_the_chat_path_HAS_a_system_prompt',
    'test_agent_chat.py::test_the_refusal_NAMES_WHICH_RULE_fired_and_by_how_much',
    'test_agent_concerns.py::test_suppression_and_the_GATE_have_different_owners',
    'test_agent_contracts.py::test_subject_key_is_the_SAME_EXPRESSION_as_the_report_pipeline_s',
    'test_agent_cost.py::test_an_escalated_device_carries_its_ENTITY_ID_not_its_handle',
    'test_agent_cost.py::test_identification_reports_how_many_it_could_name',
    'test_agent_cost.py::test_narrowing_happens_at_the_ONE_construction_site',
    'test_agent_cost.py::test_spend_is_read_from_the_ledger_and_never_recounted',
    'test_agent_cost.py::test_the_daily_ceiling_is_money_and_covers_EVERYTHING',
    'test_agent_llm.py::test_base_imports_nothing_third_party',
    'test_agent_llm.py::test_the_SDK_import_is_DEFERRED_not_module_level',
    'test_agent_llm.py::test_the_adapter_executes_no_tool_and_imports_no_policy',
    'test_agent_llm.py::test_the_flattener_has_exactly_one_implementation',
    'test_agent_policy.py::_executable_source',
    'test_agent_policy.py::test_no_model_call_exists_anywhere_in_this_module',
    'test_agent_route.py::test_BOTH_delivery_paths_tell_route_which_profile_they_used',
    'test_agent_route.py::test_route_contains_NO_MODEL_CALL',
    'test_agent_runtime.py::test_the_OUTPUT_CEILING_is_passed_on_every_request',
    'test_agent_scheduler.py::test_the_config_is_a_READER_not_a_value',
    'test_agent_session.py::test_investigate_FORWARDS_it_rather_than_accepting_it_politely',
    'test_agent_session.py::test_the_SCHEDULER_hands_its_session_to_both_tiers',
    'test_agent_sources.py::test_a_MANUAL_brief_is_attributed_to_the_person_who_pressed_it',
    'test_agent_sources.py::test_no_agent_entry_point_hardcodes_a_trigger_it_was_given',
    'test_agent_sources.py::test_the_adapter_does_NOT_hand_roll_retries',
    'test_agent_sources.py::test_the_document_and_read_salient_rank_by_the_SAME_categoriser',
    'test_agent_sources.py::test_the_document_builder_passes_BOTH_halves_of_the_loop',
    'test_agent_sources.py::test_the_offline_count_uses_the_SHARED_predicate_not_a_fourth_copy',
    'test_agent_sources.py::test_the_two_census_lines_are_noted_by_the_document_builder',
    'test_agent_sources.py::test_the_window_bound_has_ONE_derivation',
    'test_agent_triage.py::test_the_narrowed_registry_comes_FROM_the_real_one',
    'test_analysis.py::test_no_analysis_module_contains_a_physical_constant',
    'test_analysis.py::test_the_stripper_still_sees_real_code',
    'test_buttons.py::test_DELIVER_stays_the_INTERSECTION_of_every_platform',
    'test_check_switch.py::test_only_the_operators_arm_crosses_over',
    'test_collect.py::test_no_automation_instance_name_appears_in_the_collector',
    'test_compose.py::test_it_does_not_reimplement_the_deterministic_renderer',
    'test_coverage_claim.py::test_run_all_cannot_drop_a_context_field',
    'test_coverage_stamp.py::test_an_unwired_tool_is_withheld_rather_than_left_to_refuse',
    'test_coverage_stamp.py::test_the_LOOP_passes_a_stamp_and_it_is_UTC',
    'test_dedupe.py::test_the_gate_asks_ONE_question_and_the_machinery_is_GONE',
    'test_dedupe.py::test_the_two_keys_share_one_hash_expression',
    'test_flag_outcome.py::test_the_derivation_has_one_home',
    'test_flag_outcome.py::test_the_stamp_is_wired_to_the_end_of_an_investigation',
    'test_heartbeat.py::test_the_CYCLE_actually_calls_the_heartbeat',
    'test_heartbeat.py::test_the_report_does_not_recompute_what_snapshot_already_decided',
    'test_help_button.py::test_a_second_help_is_refused_by_apply_not_only_undrawn',
    'test_help_button.py::test_the_escalation_message_is_drawn_as_though_the_step_had_landed',
    'test_materiality.py::test_every_analysis_module_imports_the_shared_rule',
    'test_module_visibility.py::test_a_skip_is_logged_with_its_reason',
    'test_module_visibility.py::test_history_really_does_drop_the_analysis',
    'test_module_visibility.py::test_the_pass_names_the_checks_that_ran',
    'test_narrate_and_deliver.py::test_a_history_ENTRY_carries_its_findings_not_just_a_count',
    'test_narrate_and_deliver.py::test_no_platform_name_appears_in_the_delivery_module',
    'test_narrate_and_deliver.py::test_the_stripper_can_still_see_real_code',
    'test_narration_provider.py::_provider_hosts',
    'test_narration_provider.py::test_the_only_hostname_lives_in_its_adapter',
    'test_pass_trace.py::test_the_outbox_reports_even_when_there_is_NOTHING_to_carry',
    'test_playbooks.py::test_a_playbook_NAME_cannot_traverse_the_filesystem',
    'test_playbooks.py::test_the_system_playbooks_are_ACTUALLY_LOADED_by_a_prompt',
    'test_prefix.py::test_a_run_LOGS_THE_TOOLS_IT_USED_not_just_how_many',
    'test_prefix.py::test_the_LOG_LINE_and_the_DATA_are_one_computation',
    'test_prefix.py::test_the_RUN_LOOP_actually_logs_it',
    'test_record.py::test_the_module_never_consults_the_supervision_switch',
    'test_record_window.py::test_both_windowed_reads_share_one_implementation',
    'test_rich_delivery.py::test_the_button_only_services_stay_out_of_adapters',
    'test_rich_delivery.py::test_the_registry_lookup_has_exactly_one_implementation',
    'test_rule_calibration.py::test_the_pipeline_injects_the_fetcher_and_the_registry_copies_it',
    'test_security_validation.py::test_no_path_leads_from_a_tool_result_into_the_memory_store',
    'test_security_validation.py::test_the_policy_module_contains_no_provider_call',
    'test_stats_and_ledger.py::test_ledger_module_cannot_read_evidence_bytes',
    'test_task_loop.py::test_ESCALATION_re_sends_without_raising_a_SECOND_job',
    'test_task_loop.py::test_THE_TICK_HAS_ONE_OWNER',
    'test_task_loop.py::test_a_concern_with_no_ID_is_REFUSED_rather_than_written',
    'test_task_loop.py::test_delivery_is_the_ONLY_bar_and_there_is_no_second_one',
    'test_task_loop.py::test_the_SWEEP_is_REACHED_from_the_chase_clock',
    'test_tool_raise_concern.py::test_a_concern_records_WHICH_investigation_produced_it',
    'test_triage_clock.py::test_the_LOOP_consults_the_clock_and_records_every_pass',
    'test_upstream.py::test_a_MISSING_upstream_is_reported_rather_than_silent',
    'test_upstream.py::test_build_registry_PASSES_the_ref_table_to_the_upstream_tools',
    'test_upstream.py::test_no_install_specific_slug_is_hardcoded',
    'test_upstream.py::test_the_endpoint_is_the_SECRET_PATH_with_no_suffix',
    'test_upstream.py::test_the_hint_reaches_the_TRUNCATION_NOTE_and_not_just_the_helper',
    'test_verification_sweep.py::test_the_screen_and_the_store_agree_on_what_a_FAILED_FIX_LOOKS_LIKE',
    'test_verification_sweep.py::test_the_sweep_is_reached_from_the_villa_s_own_clock',
}


def _raw_sites() -> Set[str]:
    """Every unstripped `getsource(...)`, as `file.py::enclosing_function`.

    ⚠️ SITE-SCOPED, NOT FILE-SCOPED. The old detector asked whether the WHOLE
    FILE mentioned `strip_prose` or `code_of` anywhere, so one import bought
    blanket immunity for every other pin in it — 136 call sites across 57 files
    reported as 37 filenames. That exemption hid `test_task_loop`'s ordering
    pin, which matched a COMMENT and passed with the rule it guards reversed
    while the whole suite stayed green.

    ⚠️ KEYED ON THE ENCLOSING FUNCTION, NOT THE LINE. I froze `file.py:line`
    first and every unrelated edit to a file shifted its own entries, so the
    "only shrinks" list churned on edits that changed nothing about the pins.
    A function name is stable across edits above it and still names one site.

    ⚠️ `ast.Name` AS WELL AS `ast.Attribute`. Matching only the attribute form
    meant `from inspect import getsource` was invisible — not flagged, not
    frozen, not counted — so a one-line import could move a pin out from under
    a list advertised as a floor.
    """
    found: Set[str] = set()
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".py") or name == "conftest.py":
            continue
        try:
            tree = ast.parse(_code(name))
        except SyntaxError:                                # pragma: no cover
            continue

        # Where a bare `getsource` came from, if it was imported directly.
        bare_is_getsource = any(
            isinstance(node, ast.ImportFrom) and node.module == "inspect"
            and any(a.name == "getsource" for a in node.names)
            for node in ast.walk(tree))

        wrapped: Set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                    and node.func.id in ("strip_prose", "strip_tsx_prose"):
                for arg in node.args:
                    for inner in ast.walk(arg):
                        if isinstance(inner, ast.Call):
                            wrapped.add(id(inner))

        # Which function each line sits in, so a site keeps its name.
        owner: Dict[int, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for line in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                    owner.setdefault(line, node.name)

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or id(node) in wrapped:
                continue
            func = node.func
            is_raw = (isinstance(func, ast.Attribute) and func.attr == "getsource") \
                or (bare_is_getsource and isinstance(func, ast.Name)
                    and func.id == "getsource")
            if is_raw:
                found.add("%s::%s" % (name, owner.get(node.lineno, "<module>")))
    return found


def test_no_NEW_test_reads_source_without_stripping_prose() -> None:
    new = sorted(_raw_sites() - KNOWN_RAW)
    assert not new, (
        "test file(s) read source and assert on it without removing comments "
        "and docstrings, so a pin can match prose:\n  " + "\n  ".join(new)
        + "\n\nUse `from conftest import code_of` and assert on `code_of(fn)` "
          "instead of `inspect.getsource(fn)`.")


def test_the_frozen_list_does_not_rot() -> None:
    """⚠️ A CONVERTED FILE MUST LEAVE THE LIST. Otherwise this slowly becomes a
    record of files that once had the problem, which is the same rot every
    hand-kept set in this suite has been bitten by."""
    stale = sorted(KNOWN_RAW - _raw_sites())
    assert not stale, (
        "these no longer read source rawly — delete their lines, the backlog "
        "has shrunk: " + ", ".join(stale))


def test_the_broken_stripper_never_comes_back() -> None:
    """⚠️ IT LEAVES DOCSTRINGS AND EATS `#` INSIDE STRINGS. Six files invented
    it independently, which is what a missing shared tool looks like."""
    guilty: List[str] = []
    for name in sorted(os.listdir(HERE)):
        # ⚠️ THE DETECTOR IS NOT ITS OWN SUBJECT. This file has to SPELL the
        # pattern it bans, in a string literal, which `strip_prose` correctly
        # preserves — so scanning itself reports itself, for ever.
        if not name.endswith(".py") or name == os.path.basename(__file__):
            continue
        if 're.sub(r"#[^' in _code(name).replace("_re.", "re."):
            guilty.append(name)
    assert not guilty, (
        "file(s) strip comments with a regex that leaves docstrings and eats "
        "`#` inside string literals — use `strip_prose`: " + ", ".join(guilty))


def test_no_file_rolls_its_own_TSX_comment_stripper() -> None:
    """⚠️ THE SAME "EVERYONE INVENTS IT" PATTERN, ON THE OTHER HALF OF THE TREE.
    Two files carried a private `_strip_comments` for `.tsx`, written the same
    way, for the same reason the Python side had six copies of a regex: no
    shared tool existed. `conftest.strip_tsx_prose` is it.

    ⚠️ A file may still DEFINE `_strip_comments` as a thin alias — what is
    banned is a second implementation, spotted by the block-comment regex all
    of them are built on."""
    guilty = set()
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".py") or name == os.path.basename(__file__):
            continue
        code = _code(name)
        if 're.sub(r"/\\*' in code and "strip_tsx_prose" not in code:
            guilty.add(name)
    new = sorted(guilty - KNOWN_OWN_TSX_STRIPPER)
    assert not new, (
        "file(s) strip TSX comments with their own regex instead of the "
        "shared `strip_tsx_prose`: " + ", ".join(new))
    stale = sorted(KNOWN_OWN_TSX_STRIPPER - guilty)
    assert not stale, (
        "these no longer roll their own — delete their lines: "
        + ", ".join(stale))


def test_the_helper_actually_removes_both_kinds_of_prose() -> None:
    """⚠️ MUTATION-PROOFING. Every assertion above is satisfied by a helper
    that does nothing at all, because they only check who CALLS it."""
    from conftest import strip_prose

    sample = ('def f():\n    """Doc says WIDGET."""\n'
              '    # comment says WIDGET\n'
              '    x = "literal with # and WIDGET"\n'
              '    return mod.call(x)\n')
    out = strip_prose(sample)
    assert "Doc says WIDGET" not in out, "docstrings survive the stripper"
    assert "comment says WIDGET" not in out, "comments survive the stripper"
    assert "# and WIDGET" in out, "a `#` inside a string literal was eaten"
    assert "mod.call(x)" in out, (
        "the stripper reformatted the code — a pin spelling a call the way a "
        "human writes it would stop matching")
