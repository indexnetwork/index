# Examples

Create village content:

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli create --event-id <event-id> --kind comment --client-request-id <stable-id> --content 'Several attendees connected the session to local-first data sharing.'
npx -y @geoprotocol/geo-edge-esmeralda-cli create --venue-id <venue-id> --kind note --client-request-id <stable-id> --content 'The side conversation after lunch focused on practical onboarding for new contributors.'
npx -y @geoprotocol/geo-edge-esmeralda-cli create --track-id <track-id> --kind essay --title 'Coordination notes from week one' --client-request-id <stable-id> --content 'A synthesis of what participants have been learning about shared infrastructure.'
npx -y @geoprotocol/geo-edge-esmeralda-cli create --kind project_pitch --title 'Mutual aid map' --client-request-id <stable-id> --content 'Looking for collaborators on an offline-capable resource map.'
npx -y @geoprotocol/geo-edge-esmeralda-cli create --event-id <event-id> --kind photo --file ./photo.jpg --client-request-id <stable-id> --content 'Whiteboard from the protocol design session.'
```

Community knowledge and relations:

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool community_search --input '{"query":"housing coordination","limit":10}'
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool recent_messages --input '{"limit":10}'
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool list_content --input '{"scopeKind":"event","scopeId":"<event-id>","limit":10}'
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool get_event_content --input '{"eventId":"<event-id>","limit":20}'
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool list_idea_links --input '{"limit":20}'
```

Ontology:

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli ontology
```

Native read-only query:

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli native --query 'MATCH (c:ContentItem) WHERE c.popupId = $popupId RETURN c.id AS id, c.title AS title, c.kind AS kind LIMIT 20'
```
