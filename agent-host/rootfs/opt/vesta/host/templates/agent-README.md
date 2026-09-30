# VESTA Agent settings

- `policy.yaml`       the people and chats the agent answers, what it may ask to
                      act on, and its settings (the AI model, the cost limit per
                      reply, web search, when a conversation starts afresh).
                      Reloaded within seconds after a save.
- `instructions.md`   what the agent is told before every conversation.

Both were written once, at the first start, from the agent's examples; the
example policy is empty on purpose. Delete a file and it comes back as the
example at the next start.

The VESTA Agent host created this folder once and never overwrites anything in
it. It is included in Home Assistant backups.
