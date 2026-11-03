"""Who is who for the agent: the villa's two lists of who gets the messages, each chat's language, and every answer
read from them — who this is, what they may approve, where a role's messages go, in which language.

⚠️ ONE MODULE FOR "WHO IS WHO" (architecture review round 17, lead 1, 2026-11-03): the roster sat inside Policy, the
reader of policy.yaml's rules. It was built WITH the villa's lists in two places (config.Settings.policy,
ui.changes.page_policy) and WITHOUT them in five (the page's policy_doc, setup_copy and limits_tab, the alert desk's
siren time) — there, silently "nobody". The page built its People rows a third way, and "have the lists been read
yet?" was a file-exists check written twice. Now Policy holds the file's rules and is handed a Roster; a caller that
needs only rules never builds one, and asking a Policy built without one for who is who is an error, never "nobody".

The lists are the VESTA Kiosk's (vesta_shared.villa_recipients, owner 2026-11-03: "Yes, Kiosk only"): being in a
role's list gives that role's messages AND its rights. Each chat's language is the Kiosk's too, set beside the chat
(owner, 2026-11-03: "isn't it also redundant to show … the language selection?"): vesta_shared.kiosk_told
`chatLanguages`, by the notify entity each list row was read from. policy.yaml holds no one.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

from vesta_shared import villa_recipients
from vesta_shared.message_format import ROLE_SHORT, ROLE_WORDS

ROLES = tuple(ROLE_WORDS)
# Telegram ids that are not a person: an admin posting as the group, a channel.
ANONYMOUS_TELEGRAM_IDS = {1087968824, 136817688, 777000}
#: What a person the villa's lists do not name reads, wherever they write or press (one wording: a button press in
#: actions.py said "registered with VESTA", the others "the VESTA Agent" — review 6). ⚠️ THE KIOSK'S PLACE, NO ID
#: (architecture review round 17, lead 3): it said "You are not registered with the VESTA Agent. Your Telegram id is
#: …" — there is no registering any more, and the Kiosk picks a chat by its name, never by an id typed in.
NOT_LISTED = f"This chat is not on the villa's lists. Ask the owner to add it in {villa_recipients.WHERE}."


@dataclass
class Person:
    telegram_id: int
    name: str
    role: str
    language: str = "en"


def role_can_approve(person_role: str, required_role: str | None) -> bool:
    """May someone acting with `person_role` approve a request that needs `required_role` ("owner" or "any")?"""
    if required_role == "owner":
        return person_role == "owner"
    if required_role == "any":
        return person_role in ROLES
    return False


# ── The tablet's people (ticket 21 of "One inbox") ─────────────────────────────────────────────────────────────────
# ⚠️ ONE ANSWER TO "WHO IS THIS" (architecture review, 2026-10-29): who sits at a tablet was handed in by hand at two
# steps (the gate, the conversation) and unknown at the others — an owner's action that runs at once from their Telegram
# chat became an approval request from the tablet. The roster answers for the tablet's conversations too: the owner and
# the facility manager there are themselves (never listed, never sent a role's messages: they are not among
# `destinations`); a guest is nobody listed (answers only: tool_access.GUEST).

#: Above every Telegram chat id: Telegram's have at most 52 significant bits (its Bot API says so of every chat id).
TABLET_BASE = 2 ** 52


def tablet_profiles() -> dict[str, str]:
    """The Kiosk's profiles the agent answers, each with its role (the agreement's conversation.profiles)."""
    from vesta_shared import agreement
    return {str(k): str(v) for k, v in (agreement.section("conversation").get("profiles") or {}).items()}


def tablet_chat(profile: str | None) -> int | None:
    """The conversation of a profile, as a chat id no Telegram chat has (stable across versions: from its name)."""
    if profile not in tablet_profiles():
        return None
    return TABLET_BASE + int.from_bytes(hashlib.sha1(str(profile).encode()).digest()[:4], "big")


def tablet_profile(chat) -> str | None:
    """The profile whose conversation `chat` is; None for any other chat (a Telegram one)."""
    try:
        chat = int(chat)
    except (TypeError, ValueError):
        return None
    return next((p for p in tablet_profiles() if tablet_chat(p) == chat), None) if chat >= TABLET_BASE else None


def tablet_person(chat) -> Person | None:
    """Who writes in a tablet's conversation, from the profile the Kiosk stamped: its role's rights, named for the AI by
    the role ("Owner at the tablet"). English: the tablet's one language (ticket 28 parked). None for any other chat."""
    profile = tablet_profile(chat)
    role = tablet_profiles().get(str(profile)) if profile else None
    if not role:
        return None
    return Person(int(chat), f"{ROLE_WORDS.get(role, role.capitalize())} at the tablet", role, "en")


def chat_languages(lists, told: dict[str, str]) -> dict[int, str]:
    """{chat id: language code} from the Kiosk's {notify entity id: code} (`told`), through the entity each row of the
    villa's lists was read from; a row with no entity (a file kept before 0.12.442) or one the Kiosk names no language
    for has none (English). One entity in both lists: one language."""
    told = {str(k).lower(): v for k, v in (told or {}).items()}
    return {int(row["chat"]): told[row["entity"]] for rows in villa_recipients.normal(lists).values() for row in rows
            if row.get("entity") in told}


def listed_entries(lists, languages: dict[int, str]) -> list[Person]:
    """Every entry of the villa's lists ({role: [{"chat", "name"}]}, vesta_shared.villa_recipients): one per chat and
    role, in ROLES order then the list's, named as the villa names its notify entity, in the chat's language.

    ⚠️ ONE PERSON, TWO ROLES (owner, 2026-10-10): a chat in both lists is two entries; the person is recognised with the
    owner's rights, the wider (Roster.people), and each role's name is used where that role is meant."""
    got = villa_recipients.normal(lists)
    return [Person(int(row["chat"]), row["name"], role, languages.get(int(row["chat"]), "en"))
            for role in ROLES for row in got.get(role) or []]


class Roster:
    """The villa's lists ({role: [{"chat", "name"}]}) and each chat's language ({chat id: code}), and every answer to
    who is who read from them. `read_yet`: the lists were read at least once (a first start before the villa answered
    has nobody — said, never guessed around)."""

    def __init__(self, lists=None, languages: dict[int, str] | None = None, *, read_yet: bool | None = None):
        self.lists: dict[str, list[dict]] = villa_recipients.normal(lists)
        #: each chat's language, by chat id: the Kiosk's (chat_languages), English for a chat it names none for
        self.languages: dict[int, str] = dict(languages or {})
        self.read_yet: bool = lists is not None if read_yet is None else read_yet
        entries = listed_entries(self.lists, self.languages)
        people: dict[int, Person] = {}
        for e in entries:
            if e.telegram_id > 0 and (e.telegram_id not in people or e.role == "owner"):
                people[e.telegram_id] = e
        self.people: dict[int, Person] = people                 # by Telegram id: the owner's entry when it has two
        self.entries: list[Person] = entries                    # every entry, one per id and role (a group's included)
        # ⚠️ WHERE EACH ROLE'S MESSAGES GO IS WHO HAS THE ROLE (owner, 2026-10-10: "each message shall be sent to either
        # the Owner profiles or the Facility Manager profiles"): every chat the villa lists with a role, a person's or a
        # group's — the same lists that give the rights (owner, 2026-11-03).
        self.destinations: list[tuple[int, str]] = [(e.telegram_id, e.role) for e in entries]

    # ------------------------------------------------------------------ made
    @classmethod
    def kept(cls, pack_path: str | None) -> "Roster":
        """The lists as the agent last read them, kept beside the knowledge pack at `pack_path`
        (villa_recipients.get) — THE one answer to "have they been read yet?" (`read_yet`: the kept file is there) —
        each chat in the language the Kiosk last told for it (kiosk_told `chatLanguages`)."""
        from vesta_shared import kiosk_told
        where = villa_recipients.path(pack_path) if pack_path else None
        lists = villa_recipients.get(pack_path) if where else {}
        told = kiosk_told.get("chatLanguages", pack_path) if pack_path else {}
        return cls(lists, chat_languages(lists, told), read_yet=bool(where) and os.path.exists(where))

    @classmethod
    def of(cls, owner=(), fm=(), languages: dict | None = None) -> "Roster":
        """A roster written out: each role's chats as (chat id, name) pairs, each chat's language by id — for a test
        villa, as the Kiosk's lists and its chat languages would give them."""
        return cls({"owner": [{"chat": int(c), "name": n} for c, n in owner],
                    "fm": [{"chat": int(c), "name": n} for c, n in fm]},
                   {int(k): v for k, v in (languages or {}).items()})

    # ------------------------------------------------------------------ who this is
    def person(self, telegram_id: int | None) -> Person | None:
        """Their entry in the lists — or, in a tablet's conversation, the owner or the facility manager signed in there
        (a guest is nobody listed: tablet_person)."""
        if telegram_id is None or int(telegram_id) in ANONYMOUS_TELEGRAM_IDS:
            return None
        listed = self.people.get(int(telegram_id))
        if listed is not None:
            return listed
        tab = tablet_person(telegram_id)
        return tab if tab is not None and tab.role in ROLES else None

    def member(self, telegram_id: int | None, chat_id: int | None, name: str | None = None) -> Person | None:
        """Who this is, writing or pressing in `chat_id`: their entry; else, in a GROUP the lists name, a member of it
        with the group's role — the facility manager's when the group is listed for both (the narrower).

        ⚠️ A GROUP'S MEMBERS INHERIT ITS ROLE (owner, 2026-10-10: "a person in the group can naturally send messages in
        the group, without having to be defined as a people"): a row also sends that person every message of their
        role in private, so a group member had to choose between no answer and every alert twice. A member's rights
        hold only in that group (an anonymous admin stays nobody).

        ⚠️ THE GROUP'S ROLE, WHOEVER WRITES THERE (owner, 2026-10-10: "people in a Telegram group inherit automatically the
        role of the Telegram group they are in, irrespective of their own individual role"): a listed person kept their
        row's role in the group, so an Owner group refused the siren's approval to JM (listed as Facility manager) and
        accepted it from any unlisted member. Their own row's role holds in their private chat."""
        p = self.person(telegram_id)
        if telegram_id is None or int(telegram_id) in ANONYMOUS_TELEGRAM_IDS or chat_id is None or int(chat_id) >= 0:
            return p
        role = self.group_role(chat_id)
        if role is None:
            return p
        if p is not None:
            # ⚠️ NAMED AS THIS CHAT KNOWS THEM (architecture review 21): listed twice (JM_O, JM_FM), a person pressing in
            # a group of the facility manager's read "Done pressed by JM_FM" on an alert and "Approved by JM_O" on a
            # request — the name of a role they did not have there. One name, `name_in`'s, for every press and record
            name = self.name_in(p.telegram_id, chat_id) or p.name
            return p if (p.role, p.name) == (role, name) else Person(p.telegram_id, name, role, p.language)
        group = next((e for e in self.entries if e.telegram_id == int(chat_id) and e.role == role), None)
        return Person(int(telegram_id), (name or "").strip() or f"a member of {group.name if group else 'the group'}",
                      role, group.language if group else "en")

    def may_approve_in(self, chat_id: int, required_role: str | None) -> bool:
        """Can someone acting in `chat_id` approve a request that needs `required_role`? The rule of `member`: a private
        chat is its person's role; a listed group, its role for everyone in it — the facility manager's when listed for
        both. Where a request's buttons go (routing.approver_chats) and who may press them (actions.decide) are this one
        answer (architecture review 21: an owner's request reached a group listed for both, where "Only the owner can
        approve this." answered every press)."""
        if int(chat_id) < 0:
            role = self.group_role(chat_id)
            return role is not None and role_can_approve(role, required_role)
        p = self.person(chat_id)
        return p is not None and role_can_approve(p.role, required_role)

    def knows_chat(self, chat_id: int) -> bool:
        """Is this a chat of the villa's lists: a listed group, or the private chat of a listed person?"""
        return bool(self.roles_in(chat_id)) or int(chat_id) in self.people

    # ------------------------------------------------------------------ where a role's messages go
    def chats_for(self, role: str, language: str | None = None) -> list[int]:
        """Every chat a message for `role` goes to: each chat the villa's list of the role names — once, in the list's
        order, only those that read `language` (a code) when one is given. [] when the lists were never read.

        ⚠️ ONE LIST FOR WHERE AND WHO MAY (owner, 2026-11-03: "Yes, Kiosk only"): 0.12.436 sent to the villa's lists and
        kept the rights in the agent's People list, with a fallback to People where the villa's list named no chat; two
        lists of the same people, and a chat could receive a role's alerts and be refused its buttons."""
        return list(dict.fromkeys(c for c, r in self.destinations if r == role
                                  and (language is None or self.language_of(c, role) == language)))

    def delivered_roles(self, chat_id: int) -> set[str]:
        """The roles whose messages go to `chat_id` (chats_for): what a copy sent there is for."""
        return {r for r in ROLES if int(chat_id) in self.chats_for(r)}

    def language_of(self, chat_id: int, role: str | None) -> str:
        """The language a chat reads its `role`'s messages in: the chat's (set in the VESTA Kiosk beside the chat:
        chat_languages), en when it has none. No role (someone asking whose role is not known): the chat's first entry."""
        return next((e.language for e in self.entries if e.telegram_id == int(chat_id)
                     and (role is None or e.role == role)), "en")

    def languages_for(self, role: str) -> list[str]:
        """Every language (a code) the chats of `role` read, once, in the list's order.

        ⚠️ ONE REPORT, EVERY READER'S LANGUAGE (owner, 2026-10-23: "I received the daily report in German, whereas I
        set my language to French"): a role's report was written in its FIRST row's language and that one text went
        to every chat of the role. A role read in two languages gets one version per language (tools send_message)."""
        return list(dict.fromkeys(self.language_of(c, role) for c in self.chats_for(role)))

    def roles_in(self, chat_id: int) -> set[str]:
        """The roles a chat is listed with ({} for a chat the villa's lists do not name)."""
        return {r for c, r in self.destinations if c == int(chat_id)}

    def group_role(self, chat_id: int) -> str | None:
        """The ONE role everyone in a listed GROUP acts with — the facility manager's when the group is listed for both
        (never more where facility managers read) — or None for a private chat or a group the lists do not name.
        ⚠️ ONE ANSWER (architecture review, 2026-10-15): written three times (member, may_approve_in, tool_access), and
        reviews 18 and 21 were each one of them disagreeing with the others."""
        if int(chat_id) >= 0:
            return None
        roles = self.roles_in(chat_id)
        return ("fm" if "fm" in roles else "owner") if roles else None

    # ------------------------------------------------------------------ names
    def name_in(self, telegram_id: int, chat_id: int) -> str | None:
        """A person's name as this chat knows them: their entry for a role the chat is listed with (Fabien_FM in a chat
        of the facility manager's only), else their name — the owner's entry when they have both."""
        roles = self.roles_in(chat_id)
        named = [e.name for e in self.entries if e.telegram_id == int(telegram_id) and e.role in roles]
        p = self.person(telegram_id)
        return named[0] if len(set(named)) == 1 else (p.name if p else None)

    def names_of(self, chat_id: int) -> list[str]:
        """The names a chat is listed under, once each, in the lists' order ([] for a chat they do not name)."""
        return list(dict.fromkeys(e.name for e in self.entries if e.telegram_id == int(chat_id)))

    def chat_label(self, chat_id: int) -> str:
        """Which chat this is, in words, never who is in it: "Owner and FM group", "private chat". "" for a tablet's
        conversation (owner, 2026-10-31: Every run read "Reply to Owner at the tablet  private chat"): no Telegram chat,
        and its person already says "at the tablet" (tablet_person) — so "" means "no Telegram chat" (app.py's prompt).
        ⚠️ THE ROLES' OWN WORDS, IN THEIR ORDER (architecture review round 10: Costs read "fm and owner group", the
        sorted role ids, after every other place had been given the alert card's words): ROLE_SHORT, in ROLES order."""
        if tablet_profile(chat_id) is not None:
            return ""
        mine = self.roles_in(chat_id)
        roles = " and ".join(w for r, w in ROLE_SHORT.items() if r in mine)
        kind = "group" if int(chat_id) < 0 else "private chat"
        return f"{roles} {kind}" if roles else kind
