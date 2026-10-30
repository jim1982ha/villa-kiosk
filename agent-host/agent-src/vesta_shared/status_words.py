"""The "Status:" section of an alert card in each chat's language: the engine's own fixed words — the label, every
step line (message_format.STEPS), "6th time in 7 days", "(to: FM)", "Cleared on …", "Done on … (JM)", the bottom
line's "New alert" / "Still open" — written in every language the People list offers (vesta_agent.policy.LANGUAGES).

⚠️ EACH CHAT READS ITS OWN LANGUAGE (owner, 2026-10-23: "make the Status section of each chat's copy of an alert
follow that chat's language"). Each chat already had its own copy of a card (notice.py "EACH CHAT ITS OWN STEPS"); its
Status lines were English whatever the People list said. FIXED words, never the AI: a card is redrawn at every step,
for every chat, and must never cost a call or wait on one.

⚠️ ENGLISH IS message_format's (one wording): every function here hands English to message_format, unchanged, so a
change of the owner's English wording is made there once and no English card changes with this table. Device names,
people's names, dates, times and numbers are written as they are in every language.

⚠️ A SKILL'S OWN WORDS ARE THE SKILL'S (skills before code): what the alert desk says after a step ("No answer after
15 min", "it is no longer reported") is translated in the desk's own words.yaml; the desk sends them as `status_in`
({language: text}) beside its English `status`, and the engine picks the chat's (`pick`). Only the engine's frame of
those lines — the step, "Cleared on …", "(to: …)" — is written here, for the desk and the engine alike.
"""
from __future__ import annotations

import re

from . import message_format as mf
from .timeutil import lasting

#: Every language written here, English first: the People list's menu (vesta_agent.policy.LANGUAGES; a test holds the
#: two equal). A chat in any other language reads English.
LANGS = ("en", "fr", "id", "de", "es", "it", "nl", "zh", "ja", "ko")


def _ordinal_en(n: int) -> str:
    """2nd, 3rd, 11th, 22nd."""
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


#: Each language's words. `to`: whom a line names, at its end; `line`: a step's line where its STEPS entry has none of
#: its own; `steps`: what each step sent is called ({sent}), and the lines of the steps that read differently (`new`,
#: `back`); `times`: how many times this week, after the moment; `acted`: "<what> on <when>" (message_format.acted);
#: `colon` / `stop`: what goes before a tail and at a sentence's end; `sep`: between a step and the desk's words;
#: `units`: s, min, h, d as timeutil.lasting writes them (each joined to its number), `tight` when the parts go unspaced.
WORDS: dict[str, dict] = {
    "fr": {
        "status": "Statut", "to": " (à: {who})", "roles": {"owner": "Propriétaire", "fm": "FM"}, "nobody": "personne",
        "sent": "Envoyé", "line": "{sent} le {at}{to}",
        "steps": {"new": "Alerte envoyée", "reminder": "Rappel envoyé", "escalated": "Escalade envoyée",
                  "update": "Mise à jour envoyée", "back": "Retour: alerte envoyée",
                  "still": "Alerte « toujours là » envoyée", "reopened": "Demande de réouverture envoyée",
                  "closed": "Note de clôture envoyée"},
        "lines": {"new": "Alerte envoyée le {at}{times}{to}", "back": "De retour le {at}{times}{to}"},
        "times": ", {n}e fois en {days} jours", "acted": "{what} le {when}", "cleared": "Résolu",
        "colon": ": ", "stop": ".", "sep": ", ", "new_alert": "Nouvelle alerte", "still_open": "Toujours en cours",
        "earlier": ("… {n} notification précédente", "… {n} notifications précédentes"),
        "units": ("s", "min", "h", "j"),
        "cockpit": {"closed": "Terminé dans le Cockpit", "help": "Aide demandée dans le Cockpit", "taken": "Ticket ouvert dans le Cockpit", "reopened": "Rouvert dans le Cockpit",
                    "look_again": "Merci de vérifier à nouveau."},
    },
    "id": {
        "status": "Status", "to": " (kepada: {who})", "roles": {"owner": "Pemilik", "fm": "FM"}, "nobody": "tidak ada",
        "sent": "Terkirim", "line": "{sent} {at}{to}",
        "steps": {"new": "Peringatan terkirim", "reminder": "Pengingat terkirim", "escalated": "Eskalasi terkirim",
                  "update": "Pembaruan terkirim", "back": "Kembali: peringatan terkirim",
                  "still": "Peringatan \"masih ada\" terkirim", "reopened": "Permintaan buka kembali terkirim",
                  "closed": "Catatan penutupan terkirim"},
        "lines": {"new": "Peringatan terkirim {at}{times}{to}", "back": "Muncul lagi {at}{times}{to}"},
        "times": ", ke-{n} kali dalam {days} hari", "acted": "{what} pada {when}", "cleared": "Selesai",
        "colon": ": ", "stop": ".", "sep": ", ", "new_alert": "Peringatan baru", "still_open": "Masih terbuka",
        "earlier": ("… {n} pemberitahuan sebelumnya", "… {n} pemberitahuan sebelumnya"),
        "units": ("dtk", "mnt", "jam", "hr"),
        "cockpit": {"closed": "Selesai di Cockpit", "help": "Bantuan diminta di Cockpit", "taken": "Tiket dibuka di Cockpit", "reopened": "Dibuka kembali di Cockpit",
                    "look_again": "Mohon periksa lagi."},
    },
    "de": {
        "status": "Status", "to": " (an: {who})", "roles": {"owner": "Eigentümer", "fm": "FM"}, "nobody": "niemand",
        "sent": "Gesendet", "line": "{sent} am {at}{to}",
        "steps": {"new": "Alarm gesendet", "reminder": "Erinnerung gesendet", "escalated": "Eskalation gesendet",
                  "update": "Aktualisierung gesendet", "back": "Zurück: Alarm gesendet",
                  "still": "Alarm „noch da“ gesendet", "reopened": "Bitte um Wiedereröffnung gesendet",
                  "closed": "Abschlussnachricht gesendet"},
        "lines": {"new": "Alarm gesendet am {at}{times}{to}", "back": "Wieder da am {at}{times}{to}"},
        "times": ", {n}. Mal in {days} Tagen", "acted": "{what} am {when}", "cleared": "Behoben",
        "colon": ": ", "stop": ".", "sep": ", ", "new_alert": "Neuer Alarm", "still_open": "Weiterhin offen",
        "earlier": ("… {n} frühere Meldung", "… {n} frühere Meldungen"),
        "units": ("s", "Min.", "Std.", "Tg."),
        "cockpit": {"closed": "Im Cockpit erledigt", "help": "Hilfe im Cockpit angefordert", "taken": "Ticket im Cockpit eröffnet", "reopened": "Im Cockpit wieder geöffnet",
                    "look_again": "Bitte noch einmal prüfen."},
    },
    "es": {
        "status": "Estado", "to": " (para: {who})", "roles": {"owner": "Propietario", "fm": "FM"}, "nobody": "nadie",
        "sent": "Enviado", "line": "{sent} el {at}{to}",
        "steps": {"new": "Alerta enviada", "reminder": "Recordatorio enviado", "escalated": "Escalado enviado",
                  "update": "Actualización enviada", "back": "De vuelta: alerta enviada",
                  "still": "Alerta «sigue ahí» enviada", "reopened": "Solicitud de reapertura enviada",
                  "closed": "Nota de cierre enviada"},
        "lines": {"new": "Alerta enviada el {at}{times}{to}", "back": "De vuelta el {at}{times}{to}"},
        "times": ", {n}.ª vez en {days} días", "acted": "{what} el {when}", "cleared": "Resuelto",
        "colon": ": ", "stop": ".", "sep": ", ", "new_alert": "Nueva alerta", "still_open": "Sigue abierta",
        "earlier": ("… {n} aviso anterior", "… {n} avisos anteriores"),
        "units": ("s", "min", "h", "d"),
        "cockpit": {"closed": "Hecho en el Cockpit", "help": "Ayuda pedida en el Cockpit", "taken": "Ticket abierto en el Cockpit", "reopened": "Reabierto en el Cockpit",
                    "look_again": "Por favor, revíselo de nuevo."},
    },
    "it": {
        "status": "Stato", "to": " (a: {who})", "roles": {"owner": "Proprietario", "fm": "FM"}, "nobody": "nessuno",
        "sent": "Inviato", "line": "{sent} il {at}{to}",
        "steps": {"new": "Avviso inviato", "reminder": "Promemoria inviato", "escalated": "Escalation inviata",
                  "update": "Aggiornamento inviato", "back": "Di nuovo: avviso inviato",
                  "still": "Avviso «ancora presente» inviato", "reopened": "Richiesta di riapertura inviata",
                  "closed": "Nota di chiusura inviata"},
        "lines": {"new": "Avviso inviato il {at}{times}{to}", "back": "Di nuovo il {at}{times}{to}"},
        "times": ", {n}ª volta in {days} giorni", "acted": "{what} il {when}", "cleared": "Risolto",
        "colon": ": ", "stop": ".", "sep": ", ", "new_alert": "Nuovo avviso", "still_open": "Ancora aperto",
        "earlier": ("… {n} notifica precedente", "… {n} notifiche precedenti"),
        "units": ("s", "min", "h", "g"),
        "cockpit": {"closed": "Fatto nel Cockpit", "help": "Aiuto chiesto nel Cockpit", "taken": "Ticket aperto nel Cockpit", "reopened": "Riaperto nel Cockpit",
                    "look_again": "Si prega di ricontrollare."},
    },
    "nl": {
        "status": "Status", "to": " (aan: {who})", "roles": {"owner": "Eigenaar", "fm": "FM"}, "nobody": "niemand",
        "sent": "Verzonden", "line": "{sent} op {at}{to}",
        "steps": {"new": "Melding verzonden", "reminder": "Herinnering verzonden", "escalated": "Escalatie verzonden",
                  "update": "Update verzonden", "back": "Terug: melding verzonden",
                  "still": "Melding 'nog steeds' verzonden", "reopened": "Verzoek tot heropenen verzonden",
                  "closed": "Afsluitbericht verzonden"},
        "lines": {"new": "Melding verzonden op {at}{times}{to}", "back": "Terug op {at}{times}{to}"},
        "times": ", {n}e keer in {days} dagen", "acted": "{what} op {when}", "cleared": "Opgelost",
        "colon": ": ", "stop": ".", "sep": ", ", "new_alert": "Nieuwe melding", "still_open": "Nog open",
        "earlier": ("… {n} eerdere melding", "… {n} eerdere meldingen"),
        "units": ("s", "min", "u", "d"),
        "cockpit": {"closed": "Gedaan in de Cockpit", "help": "Hulp gevraagd in de Cockpit", "taken": "Ticket geopend in de Cockpit", "reopened": "Heropend in de Cockpit",
                    "look_again": "Kijk er alstublieft opnieuw naar."},
    },
    "zh": {
        "status": "状态", "to": " (发给: {who})", "roles": {"owner": "业主", "fm": "FM"}, "nobody": "无人",
        "sent": "已发送", "line": "{at} {sent}{to}",
        "steps": {"new": "已发送警报", "reminder": "已发送提醒", "escalated": "已发送升级通知", "update": "已发送更新",
                  "back": "再次出现：已发送警报", "still": "已发送“仍存在”警报", "reopened": "已发送重新打开请求",
                  "closed": "已发送关闭通知"},
        "lines": {"new": "{at} 已发送警报{times}{to}", "back": "{at} 再次出现{times}{to}"},
        "times": "，{days} 天内第 {n} 次", "acted": "{when} {what}", "cleared": "已解除",
        "colon": "：", "stop": "。", "sep": "，", "new_alert": "新警报", "still_open": "仍未解决",
        "earlier": ("… 之前 {n} 条通知", "… 之前 {n} 条通知"),
        "units": ("秒", "分钟", "小时", "天"), "tight": True,
        "cockpit": {"closed": "已在 Cockpit 中完成", "help": "已在 Cockpit 中请求协助", "taken": "已在 Cockpit 中开单", "reopened": "已在 Cockpit 中重新打开",
                    "look_again": "请再次检查。"},
    },
    "ja": {
        "status": "状況", "to": " (宛先: {who})", "roles": {"owner": "オーナー", "fm": "FM"}, "nobody": "なし",
        "sent": "送信済み", "line": "{at} {sent}{to}",
        "steps": {"new": "アラート送信", "reminder": "リマインダー送信", "escalated": "エスカレーション送信",
                  "update": "更新送信", "back": "再発：アラート送信", "still": "「継続中」アラート送信",
                  "reopened": "再オープン依頼送信", "closed": "終了通知送信"},
        "lines": {"new": "{at} アラート送信{times}{to}", "back": "{at} 再発{times}{to}"},
        "times": "、{days}日間で{n}回目", "acted": "{when} {what}", "cleared": "解除",
        "colon": "：", "stop": "。", "sep": "、", "new_alert": "新しいアラート", "still_open": "未解決",
        "earlier": ("… 以前の通知 {n} 件", "… 以前の通知 {n} 件"),
        "units": ("秒", "分", "時間", "日"), "tight": True,
        "cockpit": {"closed": "Cockpitで完了", "help": "Cockpitで支援を依頼", "taken": "Cockpitでチケット作成", "reopened": "Cockpitで再オープン",
                    "look_again": "もう一度確認してください。"},
    },
    "ko": {
        "status": "상태", "to": " (수신: {who})", "roles": {"owner": "소유자", "fm": "FM"}, "nobody": "없음",
        "sent": "전송됨", "line": "{at} {sent}{to}",
        "steps": {"new": "알림 전송", "reminder": "리마인더 전송", "escalated": "에스컬레이션 전송", "update": "업데이트 전송",
                  "back": "재발: 알림 전송", "still": "'계속됨' 알림 전송", "reopened": "재개 요청 전송",
                  "closed": "종료 알림 전송"},
        "lines": {"new": "{at} 알림 전송{times}{to}", "back": "{at} 재발{times}{to}"},
        "times": ", {days}일 동안 {n}번째", "acted": "{when} {what}", "cleared": "해제됨",
        "colon": ": ", "stop": ".", "sep": ", ", "new_alert": "새 알림", "still_open": "아직 열림",
        "earlier": ("… 이전 알림 {n}건", "… 이전 알림 {n}건"),
        "units": ("초", "분", "시간", "일"), "tight": True,
        "cockpit": {"closed": "Cockpit에서 완료됨", "help": "Cockpit에서 도움 요청됨", "taken": "Cockpit에서 티켓 생성됨", "reopened": "Cockpit에서 다시 열림",
                    "look_again": "다시 확인해 주세요."},
    },
}


def lang_of(code) -> str:
    """A chat's language as written here: its code when this table has it, else English."""
    return code if isinstance(code, str) and code in WORDS else "en"


def _w(lang: str) -> dict | None:
    """The language's words; None for English (message_format's own)."""
    return WORDS.get(lang_of(lang))


def label(lang: str = "en") -> str:
    """The label of an alert's where-it-stands section: "Status", "Statut", "状态"."""
    w = _w(lang)
    return w["status"] if w else mf.STATUS


#: Every language's label: message_format.parts finds the Status section of an alert in any of them.
LABELS = tuple(dict.fromkeys([mf.STATUS] + [w["status"] for w in WORDS.values()]))


def who(roles, lang: str = "en") -> str:
    """The roles as a card's Status line names them, in message_format.ROLES order: "Owner & FM", "Propriétaire & FM"."""
    w = _w(lang)
    if not w:
        return mf.audience(roles, short=True)
    wanted = set(roles or ())
    return mf.AND.join(w["roles"][r] for r in mf.ROLES if r in wanted)


def nobody(lang: str = "en") -> str:
    """Whom a step to no role names."""
    w = _w(lang)
    return w["nobody"] if w else "nobody"


def to_tail(whom: str, lang: str = "en") -> str:
    """The end of every Status line: " (to: FM)", " (à: FM)"."""
    w = _w(lang)
    return (w["to"] if w else " (to: {who})").format(who=whom)


def sep(lang: str = "en") -> str:
    """Between a step and the desk's words on a bottom line (notice.STEP_SEP in English)."""
    w = _w(lang)
    return w["sep"] if w else ", "


def times(n, days: int, lang: str = "en") -> str:
    """How many times this week, after a step's moment: ", 6th time in 7 days", ", 6e fois en 7 jours"; "" for the
    first time or an older record that has no count."""
    if not (isinstance(n, int) and not isinstance(n, bool) and n > 1):
        return ""
    w = _w(lang)
    return w["times"].format(n=n, days=days) if w else f", {_ordinal_en(n)} time in {days} days"


def step(stage: str | None, at: str, times_text: str, whom: str, lang: str = "en") -> str:
    """A step as a card's Status says it — what was sent, when, to whom (message_format.STEPS, its words in `lang`)."""
    w = _w(lang)
    s = mf.STEPS.get(stage or "")
    if not w:
        return (s.line if s else "{sent} {at} (to: {who})").format(
            sent=s.sent if s else "Sent", at=at, times=times_text, who=whom)
    sent = w["steps"].get(stage or "", w["sent"]) if s else w["sent"]
    line = w["lines"].get(stage or "", w["line"]) if s else w["line"]
    return line.format(sent=sent, at=at, times=times_text, to=to_tail(whom, lang))


def acted(what: str, when: str, whom: str = "", lang: str = "en") -> str:
    """A person's act: "Done on 19/10/2026 02:10 (JM)", "Terminé le 19/10/2026 02:10 (JM)" (message_format.acted)."""
    w = _w(lang)
    if not w:
        return mf.acted(what, when, whom)
    return w["acted"].format(what=what, when=when) + (f" ({whom})" if whom else "")


def cockpit(act: str, when: str, whom: str = "", lang: str = "en") -> str:
    """What a person did in the Cockpit (message_format.COCKPIT: "closed", "taken", "reopened"), as a line says it in
    `lang`: "Done in the Cockpit on 11/10/2026 07:05 (JM)", "Terminé dans le Cockpit le 11/10/2026 07:05 (JM)"."""
    w = _w(lang)
    return acted(w["cockpit"][act] if w else mf.COCKPIT[act], when, whom, lang)


def look_again(lang: str = "en") -> str:
    """The ask after a reopening: "Please look again.", "Merci de vérifier à nouveau."."""
    w = _w(lang)
    return w["cockpit"]["look_again"] if w else mf.COCKPIT["look_again"]


def colon(lang: str = "en") -> str:
    """Before a tail: ": ", "：" (message_format writes ": " in English)."""
    w = _w(lang)
    return w["colon"] if w else ": "


def space(lang: str = "en") -> str:
    """Between two sentences: " ", none in a language written without (`tight`)."""
    w = _w(lang)
    return "" if w and w.get("tight") else " "


def stop(lang: str = "en") -> str:
    """A sentence's end: ".", "。"."""
    w = _w(lang)
    return w["stop"] if w else "."


def pressed(label_: str, name: str, time: str = "{time}", lang: str = "en") -> str:
    """A pressed button's line (message_format.PRESSED): "Done on {time} (JM).", the label in the chat's language."""
    if not _w(lang):
        return mf.PRESSED.format(label=label_, name=name, time=time)
    return acted(label_, time, name, lang) + stop(lang)


def closing(tail: str = "", lang: str = "en") -> str:
    """How an alert that is over says it (message_format.closing): "Cleared on {time}: <tail>.", "Résolu le {time}:
    <tail>."; "{time}" filled when shown."""
    w = _w(lang)
    if not w:
        return mf.closing(tail)
    return acted(w["cleared"], "{time}", "", lang) + (f"{w['colon']}{tail}" if tail else "") + w["stop"]


def stage_words(word: str, time: str = "", lang: str = "en") -> str:
    """A stage's own bottom line (message_format.stage_words): "New alert", "Still open", "Cleared on <time>." — with no
    time to give, the moment left out ("Cleared.")."""
    w = _w(lang)
    if not w:
        return mf.stage_words(word, time)
    if word in mf.CLOSED_STAGES:
        return closing("", lang).replace("{time}", time) if time else w["cleared"] + w["stop"]
    return w["new_alert"] if word == "new" else w["still_open"]


def earlier(n: int, lang: str = "en") -> str:
    """The line counting the history lines left out: "… 3 earlier notices" (layout.render, notice._kept)."""
    w = _w(lang)
    if not w:
        return f"… {n} earlier notice{'s' if n > 1 else ''}"
    return w["earlier"][0 if n == 1 else 1].format(n=n)


def duration(seconds: float, lang: str = "en") -> str:
    """A duration as timeutil.lasting words it ("1h 30min"), its units in `lang` ("1Std. 30Min.", "1小时30分钟"): each
    unit joined to its number (owner, 2026-10-24), the parts apart by a space — none where `tight`."""
    words = lasting(seconds)
    w = _w(lang)
    if not w:
        return words
    unit = dict(zip(("s", "min", "h", "d"), w["units"]))
    out = [f"{n}{unit[u]}" for n, u in re.findall(r"(\d+)([a-z]+)", words)]
    return ("" if w.get("tight") else " ").join(out)


def pick(text: str, texts: dict | None, lang: str = "en") -> str:
    """A skill's words for a chat of `lang`: its own version in `texts` ({language: text}, a skill's `status_in`), else
    `text` (the English it always gives) — a skill edited before this, or a language it does not write, reads English."""
    got = (texts or {}).get(lang_of(lang)) if isinstance(texts, dict) else None
    return got if isinstance(got, str) and got.strip() else (text or "")
