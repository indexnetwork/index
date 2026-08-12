import Foundation

private enum FixtureFailure: Error { case assertion(String) }
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw FixtureFailure.assertion(message) }
}
private func object(_ values: [String: NativeJSONValue] = [:]) -> NativeJSONValue { .object(values) }
private func string(_ value: String) -> NativeJSONValue { .string(value) }
private func array(_ values: [NativeJSONValue]) -> NativeJSONValue { .array(values) }

@main
enum NativeAPIBodyValidationFixture {
    static func main() throws {
        let id = string("00000000-0000-4000-8000-000000000001")
        let empty = object()
        let rounds = array([object(["prompt": string("Who?"), "answer": object(["selectedOptions": array([string("Founders")])])])])
        let draft = object([
            "identity": object(["name": string("Owner"), "bio": string("Builder"), "location": string("NY")]),
            "narrative": object(["context": string("Builds safe systems")]),
            "attributes": object(["skills": array([string("security")]), "interests": array([string("networks")])]),
        ])
        let admitted: [(String, String, NativeJSONValue)] = [
            ("PATCH", "/auth/profile/update", object(["name": string("Owner"), "timezone": string("America/New_York"), "socials": array([object(["label": string("github"), "value": string("https://github.com/o")])]), "notificationPreferences": object(["connectionUpdates": .bool(true), "weeklyNewsletter": .bool(false)])])),
            ("PUT", "/agent-runtime", object(["runtime": string("index")])),
            ("POST", "/agent-runtime/hermes/prepare", object(["installationId": id, "setupAttemptId": id])),
            ("POST", "/agent-runtime/rollback", object(["setupAttemptId": id])),
            ("POST", "/networks", object(["title": string("Builders"), "joinPolicy": string("invite_only")])),
            ("POST", "/networks/n1/join", empty),
            ("POST", "/network-requests", object(["name": string("N"), "purpose": string("P"), "expectedSize": string("10-20"), "joinPolicy": string("invite_only")])),
            ("PATCH", "/network-requests/r1", object(["name": string("N"), "purpose": string("P"), "expectedSize": string("10"), "joinPolicy": string("anyone")])),
            ("POST", "/intents/list", object(["page": .number(1), "limit": .number(10), "archived": .bool(false), "sourceType": string("manual")])),
            ("POST", "/intents/confirm", object(["proposalId": id, "description": string("Intent")])),
            ("POST", "/intents/reject", object(["proposalId": id])),
            ("POST", "/intents/intake/start", empty),
            ("POST", "/intents/intake/question", object(["rounds": rounds, "plannedTotal": .number(2)])),
            ("POST", "/intents/intake/prepare", object(["rounds": rounds])),
            ("POST", "/intents/intake/proposal", object(["runId": id, "rounds": rounds])),
            ("POST", "/intents/intake/revise", object(["runId": id, "rounds": rounds, "feedback": string("revise")])),
            ("PATCH", "/intents/i1/status", object(["status": string("ACTIVE")])),
            ("PATCH", "/opportunities/o1/status", object(["status": string("accepted")])),
            ("POST", "/opportunities/o1/start-chat", empty),
            ("POST", "/questions/q1/answer", object(["selectedOptions": array([string("yes")])])),
            ("POST", "/questions/q1/dismiss", empty),
            ("POST", "/tools/read_user_contexts", object(["query": empty])),
            ("POST", "/tools/preview_user_context", object(["query": object(["bioOrDescription": string("Builder")])])),
            ("POST", "/tools/confirm_user_context", object(["query": object(["draft": draft])])),
            ("POST", "/enrichment/enrich", empty),
            ("POST", "/conversations/dm", object(["peerUserId": id])),
            ("POST", "/conversations/c1/messages", object(["parts": array([object(["text": string("hello")])])])),
            ("PATCH", "/conversations/c1/metadata", object(["metadata": object(["title": string("Conversation")])])),
        ]
        for (method, path, body) in admitted {
            try require(NativeAPIRequestBridge.validateHTTPBodyForFixture(method: method, path: path, body: body), "valid body rejected: \(method) \(path)")
        }

        try require(NativeAPIRequestBridge.validateSSEBodyForFixture(method: "POST", path: "/chat/stream", body: object(["message": string("hello"), "persona": string("negotiator")])), "valid chat stream rejected")
        try require(NativeAPIRequestBridge.validateMCPForFixture(arguments: object(["description": string("Meet founders"), "autoApprove": .bool(true)])), "valid create_intent rejected")

        for runtime in ["index", "hermes"] {
            let body = runtime == "index" ? object(["runtime": string(runtime)]) : object(["runtime": string(runtime), "installationId": id, "executorId": id, "setupAttemptId": id])
            try require(NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "PUT", path: "/agent-runtime", body: body), "runtime enum parity failed: \(runtime)")
        }
        try require(!NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "PUT", path: "/agent-runtime", body: object(["runtime": string("unknown")])), "unknown runtime accepted")
        for policy in ["anyone", "invite_only"] {
            try require(NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "POST", path: "/networks", body: object(["title": string("N"), "joinPolicy": string(policy)])), "network policy parity failed: \(policy)")
        }
        try require(!NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "POST", path: "/networks", body: object(["title": string("N"), "joinPolicy": string("approval")])), "unknown network policy accepted")
        for persona in ["negotiator", "signal", "reporter"] {
            try require(NativeAPIRequestBridge.validateSSEBodyForFixture(method: "POST", path: "/chat/stream", body: object(["message": string("hi"), "persona": string(persona)])), "chat persona parity failed: \(persona)")
        }
        try require(!NativeAPIRequestBridge.validateSSEBodyForFixture(method: "POST", path: "/chat/stream", body: object(["message": string("hi"), "persona": string("orchestrator")])), "unknown chat persona accepted")
        for scope in ["network", "intent"] {
            try require(NativeAPIRequestBridge.validateSSEBodyForFixture(method: "POST", path: "/chat/stream", body: object(["message": string("hi"), "scopeType": string(scope), "scopeId": id])), "chat scope parity failed: \(scope)")
        }
        try require(!NativeAPIRequestBridge.validateSSEBodyForFixture(method: "POST", path: "/chat/stream", body: object(["message": string("hi"), "scopeType": string("global"), "scopeId": id])), "unknown chat scope accepted")

        for status in ["ACTIVE", "PAUSED"] {
            try require(NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "PATCH", path: "/intents/i1/status", body: object(["status": string(status)])), "intent enum parity failed: \(status)")
        }
        for status in ["active", "paused", "FULFILLED", "EXPIRED", "unknown"] {
            try require(!NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "PATCH", path: "/intents/i1/status", body: object(["status": string(status)])), "unknown intent status accepted: \(status)")
        }
        for status in ["accepted", "rejected"] {
            try require(NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "PATCH", path: "/opportunities/o1/status", body: object(["status": string(status)])), "opportunity owner subset parity failed: \(status)")
        }
        for status in ["latent", "draft", "pending", "negotiating", "stalled", "expired", "liked", "disliked", "introduced", "unknown"] {
            try require(!NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "PATCH", path: "/opportunities/o1/status", body: object(["status": string(status)])), "unused global opportunity status accepted: \(status)")
        }

        var deep: NativeJSONValue = string("x")
        for _ in 0..<17 { deep = object(["nested": deep]) }
        try require(!NativeAPIRequestBridge.validateGlobalJSONForFixture(deep), "depth overflow accepted")
        try require(!NativeAPIRequestBridge.validateGlobalJSONForFixture(object(Dictionary(uniqueKeysWithValues: (0..<65).map { ("k\($0)", string("x")) }))), "object-key overflow accepted")
        try require(!NativeAPIRequestBridge.validateGlobalJSONForFixture(array((0..<101).map { _ in string("x") })), "array overflow accepted")
        try require(!NativeAPIRequestBridge.validateGlobalJSONForFixture(string(String(repeating: "x", count: 65_537))), "string overflow accepted")
        try require(!NativeAPIRequestBridge.validateGlobalJSONForFixture(object(["a": string(String(repeating: "x", count: 65_536)), "b": string(String(repeating: "x", count: 65_536)), "c": string(String(repeating: "x", count: 65_536)), "d": string(String(repeating: "x", count: 65_536))])), "serialized overflow accepted")

        for invalid in [
            object(["runtime": .bool(true)]),
            object(["runtime": .null]),
            object(["runtime": string("index"), "nested": object(["unknown": string("x")])]),
        ] {
            try require(!NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "PUT", path: "/agent-runtime", body: invalid), "wrong/null/unknown typed body accepted")
        }
        try require(!NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "POST", path: "/network-requests", body: object(["name": string("N"), "purpose": string("P"), "expectedSize": .bool(true), "joinPolicy": string("approval")])), "bool-as-number accepted")
        try require(!NativeAPIRequestBridge.validateMCPForFixture(arguments: object(["description": string("x"), "autoApprove": .number(1)])), "MCP bool-as-number accepted")
        for tool in ["delete_agent", "grant_agent_permission", "tools/list", "prompts/list", "resources/list"] {
            try require(!NativeAPIRequestBridge.validateMCPForFixture(tool: tool, arguments: object(["description": string("x")])), "arbitrary MCP tool accepted: \(tool)")
        }
        for route in ["/tools/delete_agent", "/tools/grant_agent_permission", "/tools/arbitrary"] {
            try require(!NativeAPIRequestBridge.validateHTTPBodyForFixture(method: "POST", path: route, body: object(["query": empty])), "arbitrary REST tool accepted: \(route)")
        }
    }
}
