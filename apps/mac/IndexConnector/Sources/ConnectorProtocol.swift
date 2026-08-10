import Foundation

enum ConnectorProtocolVersion {
    static let current = 1
}

indirect enum JSONValue: Codable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.typeMismatch(
                JSONValue.self,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Value is not valid JSON"
                )
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case let .bool(value):
            try container.encode(value)
        case let .number(value):
            try container.encode(value)
        case let .string(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        }
    }
}

enum ConnectorOperation: String, Codable {
    case hello, status, authorizeStart, authorizePoll, rest, mcp, disconnect
}

struct ConnectorRequest: Codable, Equatable {
    let protocolVersion: Int
    let id: String
    let operation: ConnectorOperation
    let payload: [String: JSONValue]
}

struct ConnectorError: Codable, Equatable {
    let code: String
    let message: String
}

struct ConnectorResponse: Codable, Equatable {
    let protocolVersion: Int
    let id: String
    let success: Bool
    let result: JSONValue?
    let error: ConnectorError?
}

enum ConnectorProtocolError: Error, Equatable {
    case requestTooLarge(actual: Int, maximum: Int)
    case malformedRequest
    case invalidTopLevel
    case unknownTopLevelKeys([String])
    case missingTopLevelKeys([String])
    case unsupportedProtocolVersion(Int)
    case invalidCorrelationID
    case forbiddenResponseField(String)
}

enum StrictConnectorDecoder {
    static let maximumRequestBytes = 262_144
    private static let requestKeys: Set<String> = [
        "protocolVersion", "id", "operation", "payload",
    ]

    static func decode(_ data: Data) throws -> ConnectorRequest {
        guard data.count <= maximumRequestBytes else {
            throw ConnectorProtocolError.requestTooLarge(
                actual: data.count,
                maximum: maximumRequestBytes
            )
        }

        let json: Any
        do {
            json = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw ConnectorProtocolError.malformedRequest
        }
        guard let object = json as? [String: Any] else {
            throw ConnectorProtocolError.invalidTopLevel
        }
        try rejectUnknownKeys(Set(object.keys), allowed: requestKeys)

        let request: ConnectorRequest
        do {
            request = try JSONDecoder().decode(ConnectorRequest.self, from: data)
        } catch {
            throw ConnectorProtocolError.malformedRequest
        }
        guard request.protocolVersion == ConnectorProtocolVersion.current else {
            throw ConnectorProtocolError.unsupportedProtocolVersion(request.protocolVersion)
        }
        guard !request.id.isEmpty, request.id.count <= 128 else {
            throw ConnectorProtocolError.invalidCorrelationID
        }
        return request
    }

    private static func rejectUnknownKeys(_ actual: Set<String>, allowed: Set<String>) throws {
        let unknown = actual.subtracting(allowed).sorted()
        if !unknown.isEmpty {
            throw ConnectorProtocolError.unknownTopLevelKeys(unknown)
        }
        let missing = allowed.subtracting(actual).sorted()
        if !missing.isEmpty {
            throw ConnectorProtocolError.missingTopLevelKeys(missing)
        }
    }
}

enum ConnectorResponseValidator {
    private static let forbiddenKeys: Set<String> = [
        "apikey",
        "credential",
        "authorizationcode",
        "pkceverifier",
        "verifier",
        "headers",
        "authorization",
        "x-api-key",
    ]

    static func validate(_ response: ConnectorResponse) throws {
        guard response.protocolVersion == ConnectorProtocolVersion.current else {
            throw ConnectorProtocolError.unsupportedProtocolVersion(response.protocolVersion)
        }
        guard !response.id.isEmpty, response.id.count <= 128 else {
            throw ConnectorProtocolError.invalidCorrelationID
        }
        if let result = response.result {
            try validate(result)
        }
    }

    private static func validate(_ value: JSONValue) throws {
        switch value {
        case let .array(values):
            try values.forEach(validate)
        case let .object(object):
            for (key, nestedValue) in object {
                if forbiddenKeys.contains(key.lowercased()) {
                    throw ConnectorProtocolError.forbiddenResponseField(key)
                }
                try validate(nestedValue)
            }
        case .null, .bool, .number, .string:
            break
        }
    }
}

enum StrictConnectorEncoder {
    static func encode(_ response: ConnectorResponse) throws -> Data {
        try ConnectorResponseValidator.validate(response)
        return try JSONEncoder().encode(response)
    }
}
