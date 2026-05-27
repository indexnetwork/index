# Ontology Guidance

Prefer live ontology:

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli ontology
```

The ontology response lists node labels, fields, relationship triples, fixed
tools, and native-query constraints. Use it as the source of truth for native
query construction.

Important v2 native-query constraints:

- Use one read-only `MATCH ... RETURN ... LIMIT ...` statement.
- Include `$popupId`; the server controls the parameter value.
- Filter popup-scoped labels with `n.popupId = $popupId`.
- Filter `Popup`, `Track`, `Event`, and `Venue` rows with `hidden = false`.
- Keep `WHERE` to top-level `AND`-joined scalar comparisons. Scope filters
  must remain equality filters like `e.popupId = $popupId AND e.hidden = false`.
- Return scalar fields, not whole nodes or `RETURN *`.
- List fields keep `type=json` for compatibility and include
  `nativeType=text[]`; they are returned as native arrays.
- Do not use mutation, admin, import, vector procedure, or unbounded queries.
