import Foundation

@main
struct IndexConnectorMain {
    static func main() {
        let runtime: ConnectorRuntime?
        do {
            let installationStore = try ConnectorInstallationStore()
            runtime = try ConnectorRuntime(installationStore: installationStore)
        } catch {
            runtime = nil
        }

        while let line = readLine(strippingNewline: true) {
            let data = Data(line.utf8)
            do {
                let request = try StrictConnectorDecoder.decode(data)
                let response: ConnectorResponse
                if let runtime {
                    response = runtime.handle(request)
                } else {
                    response = ConnectorResponse(
                        protocolVersion: ConnectorProtocolVersion.current,
                        id: request.id,
                        success: false,
                        result: nil,
                        error: ConnectorError(
                            code: "runtime_unavailable",
                            message: "The connector runtime is unavailable."
                        )
                    )
                }
                try write(response)
            } catch {
                guard let id = correlationID(from: data) else { continue }
                let response = ConnectorResponse(
                    protocolVersion: ConnectorProtocolVersion.current,
                    id: id,
                    success: false,
                    result: nil,
                    error: ConnectorError(
                        code: "invalid_request",
                        message: "The connector request is invalid."
                    )
                )
                try? write(response)
            }
        }
    }

    private static func correlationID(from data: Data) -> String? {
        guard data.count <= StrictConnectorDecoder.maximumRequestBytes,
              let json = try? JSONSerialization.jsonObject(with: data),
              let object = json as? [String: Any],
              let id = object["id"] as? String,
              !id.isEmpty, id.count <= 128 else { return nil }
        return id
    }

    private static func write(_ response: ConnectorResponse) throws {
        var encoded = try StrictConnectorEncoder.encode(response)
        encoded.append(0x0A)
        try FileHandle.standardOutput.write(contentsOf: encoded)
    }
}
