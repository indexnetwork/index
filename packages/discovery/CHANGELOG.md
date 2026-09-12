# Changelog

## 0.2.0

### Breaking changes

- Remove lens inference, HyDE generation/validation, and the `Artifacts` pipeline.
  `Discovery` now embeds the caller's query once and searches real intent vectors.
  Hosts supply `embedder` instead of `prepareArtifacts`.
