# proposals

The monthly report lists what VESTA suggests, each with its number ("Proposal 3"). The number is the proposal's own,
kept for good: the same proposal has the same number on every report, and a number is never given twice.

The owner answers one with `/proposal accept 3`, `/proposal later 3` or `/proposal ignore 3`. Run
`answer.py answer --number 3 --choice accept` (or `later`, `ignore`) and reply with its `text`, word for word:

- accept: the owner agrees; it leaves the report.
- later: it stays, and is on the next report again.
- ignore: it leaves the report and is never suggested again.

Answering the same number again changes the answer. Only the owner answers: the script refuses anyone else and says
so — repeat what it says, never record an answer another way. Never guess a number or an answer the person did not
write: ask for it, as `/proposal accept 3`, `/proposal later 3` or `/proposal ignore 3`.
