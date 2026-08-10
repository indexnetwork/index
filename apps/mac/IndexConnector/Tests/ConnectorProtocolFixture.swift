import Foundation

private func expectProtocolError(
    _ expected: ConnectorProtocolError,
    _ body: () throws -> Void
) {
    do {
        try body()
        preconditionFailure("Expected \(expected)")
    } catch let error as ConnectorProtocolError {
        precondition(error == expected, "Expected \(expected), received \(error)")
    } catch {
        preconditionFailure("Expected ConnectorProtocolError, received \(error)")
    }
}

@main
struct ConnectorProtocolFixture {
    static func main() throws {
        let valid = Data(#"{"protocolVersion":1,"id":"fixture-1","operation":"hello","payload":{"nested":[true,3,"ok",null]}}"#.utf8)
        let request = try StrictConnectorDecoder.decode(valid)
        precondition(request.protocolVersion == 1)
        precondition(request.id == "fixture-1")
        precondition(request.operation == .hello)

        expectProtocolError(.unknownTopLevelKeys(["unexpected"])) {
            _ = try StrictConnectorDecoder.decode(
                Data(#"{"protocolVersion":1,"id":"fixture-1","operation":"status","payload":{},"unexpected":true}"#.utf8)
            )
        }
        expectProtocolError(.missingTopLevelKeys(["payload"])) {
            _ = try StrictConnectorDecoder.decode(
                Data(#"{"protocolVersion":1,"id":"fixture-1","operation":"status"}"#.utf8)
            )
        }
        expectProtocolError(.unsupportedProtocolVersion(2)) {
            _ = try StrictConnectorDecoder.decode(
                Data(#"{"protocolVersion":2,"id":"fixture-1","operation":"status","payload":{}}"#.utf8)
            )
        }
        expectProtocolError(.invalidCorrelationID) {
            let longID = String(repeating: "x", count: 129)
            _ = try StrictConnectorDecoder.decode(
                Data("{\"protocolVersion\":1,\"id\":\"\(longID)\",\"operation\":\"status\",\"payload\":{}}".utf8)
            )
        }
        expectProtocolError(
            .requestTooLarge(
                actual: StrictConnectorDecoder.maximumRequestBytes + 1,
                maximum: StrictConnectorDecoder.maximumRequestBytes
            )
        ) {
            _ = try StrictConnectorDecoder.decode(
                Data(repeating: 0x20, count: StrictConnectorDecoder.maximumRequestBytes + 1)
            )
        }

        let allowedErrorCode = ConnectorResponse(
            protocolVersion: ConnectorProtocolVersion.current,
            id: "fixture-1",
            success: false,
            result: .object(["code": .string("authorization_pending")]),
            error: ConnectorError(code: "authorization_pending", message: "Pending")
        )
        let allowedData = try StrictConnectorEncoder.encode(allowedErrorCode)
        let allowedJSON = String(decoding: allowedData, as: UTF8.self)
        precondition(allowedJSON.contains("authorization_pending"))

        for forbiddenKey in [
            "apiKey", "credential", "authorizationCode", "pkceVerifier",
            "verifier", "headers", "authorization", "x-api-key", "APIKEY",
        ] {
            let response = ConnectorResponse(
                protocolVersion: ConnectorProtocolVersion.current,
                id: "fixture-1",
                success: true,
                result: .object(["nested": .array([.object([forbiddenKey: .string("secret")])])]),
                error: nil
            )
            expectProtocolError(.forbiddenResponseField(forbiddenKey)) {
                _ = try StrictConnectorEncoder.encode(response)
            }
        }

        print("Connector protocol fixture passed")
    }
}
