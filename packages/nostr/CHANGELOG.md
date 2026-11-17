# Changelog

## 0.1.0

### Added

- First release: Index kinds 31641 (intent) and 4641–4645 (negotiation opening and turn, opportunity, opportunity response, host status), specified in `nips/NIP-IX.md`.
- Signed gift wraps (`signAndWrap`, `wrapSigned`, `unwrap`): NIP-59 envelopes whose inner event stays signed, so transcripts are verifiable.
- NIP-OA owner attestation (`createAuthTag`, `verifyAttestation`, `principalOf`), passing Buzz's published test vectors.
- `NegotiationLedger` and `replayNegotiation`, which apply `decideNegotiationTurn` and `decideNegotiationResume` from `@indexnetwork/protocol` to Nostr turns.
- Builders and parsers for intents, networks (NIP-29), opportunities, host status and Buzz interop events.
- `isValidEvent`, a signature check that ignores nostr-tools' verification cache.
