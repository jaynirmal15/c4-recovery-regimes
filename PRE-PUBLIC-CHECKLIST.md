# Before this repository is made public

State on 2026-10-08: the repository is private and has no tags or releases. Nothing below has been
done. Each item is to be ticked by the person who did it, with the date.

- [ ] **Rotate the LiveKit API key once more**, after the last lab session and before the
  repository is made public. The control-arm records (`control/`, `control-shakedown/`) contain
  participant access tokens signed with the key in use on 2026-10-07; the study records contain
  tokens signed with the key retired on 2026-10-06. After this rotation every token in the history
  is both expired (each was valid for two hours) and signed by a retired key.
- [ ] **README paragraph on secrets in the records**, covering both classes and saying why each is
  inert, in the place a reader who finds them will look:
  - participant access tokens in the LiveKit server and webhook logs: expired after two hours, and
    signed by a retired key (true only once the rotation above is done);
  - a per-room `turnPassword` in the room object of the LiveKit server logs: LiveKit's built-in TURN
    server was disabled (`deploy/livekit/values.yaml`, `turn.enabled: false`), and every join
    response in the logs offers STUN servers only, so no service accepted that credential.
  The trial records themselves stay as the instrument wrote them; nothing is redacted.
- [ ] **The deliberate look** by the author at the whole tree and history before any public flip.
- [ ] **Confirm the repository is still private with no tags and no releases** immediately before
  the flip, and that the local history matches what is about to become public.
