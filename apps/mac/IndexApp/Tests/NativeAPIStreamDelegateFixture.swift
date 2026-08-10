import Foundation

private enum FixtureFailure: Error { case assertion(String) }
private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    guard condition() else { throw FixtureFailure.assertion(message) }
}

@main
enum NativeAPIStreamDelegateFixture {
    static func main() throws {
        let url = URL(string: "https://api.example.test/api/chat/stream")!
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: url)
        var events: [NativeAPIEvent] = []
        var completions: [(NativeAPIRequestFailure?, Int?)] = []
        let delegate = NativeAPIStreamDelegate(
            requestId: "stream-1",
            publish: { events.append($0); return true },
            isSafe: { _ in true },
            complete: { completions.append(($0, $1)) }
        )
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/event-stream", "X-Session-Id": "session-1"]
        )!
        var disposition: URLSession.ResponseDisposition = .cancel
        delegate.urlSession(session, dataTask: task, didReceive: response) { disposition = $0 }
        try require(disposition == .allow, "valid SSE headers rejected")
        try require(events.count == 1, "headers were not published immediately")

        delegate.urlSession(session, dataTask: task, didReceive: Data("data: {\"type\":\"delta\"}\n\n".utf8))
        try require(events.count == 2, "mid-stream event was completion-buffered")
        try require(completions.isEmpty, "stream completed before delegate completion")
        delegate.urlSession(session, task: task, didCompleteWithError: nil)
        try require(completions.count == 1 && completions[0].0 == nil && completions[0].1 == 200,
                    "valid stream did not complete exactly once")

        // A partial frame over 64 KiB cancels immediately rather than buffering.
        let overflowTask = session.dataTask(with: url)
        var overflow: NativeAPIRequestFailure?
        let overflowDelegate = NativeAPIStreamDelegate(
            requestId: "stream-overflow", publish: { _ in true }, isSafe: { _ in true },
            complete: { overflow = $0 }
        )
        overflowDelegate.urlSession(session, dataTask: overflowTask, didReceive: response) { _ in }
        overflowDelegate.urlSession(session, dataTask: overflowTask, didReceive: Data(repeating: 0x61, count: 65_537))
        if case .oversizedResponse? = overflow {} else { throw FixtureFailure.assertion("partial-frame overflow was not cancelled") }

        // Malformed UTF-8/framing is terminal and does not publish a partial event.
        let malformedTask = session.dataTask(with: url)
        var malformed: NativeAPIRequestFailure?
        let malformedDelegate = NativeAPIStreamDelegate(
            requestId: "stream-malformed", publish: { _ in true }, isSafe: { _ in true },
            complete: { malformed = $0 }
        )
        malformedDelegate.urlSession(session, dataTask: malformedTask, didReceive: response) { _ in }
        malformedDelegate.urlSession(session, dataTask: malformedTask, didReceive: Data([0xff, 0x0a, 0x0a]))
        if case .transportFailure? = malformed {} else { throw FixtureFailure.assertion("malformed SSE was not cancelled") }

        func proveRawOverflow(frame: Data, requestId: String, failureMessage: String) throws {
            let aggregateTask = session.dataTask(with: url)
            var aggregateEvents: [NativeAPIEvent] = []
            var aggregateCompletions: [NativeAPIRequestFailure?] = []
            let aggregateDelegate = NativeAPIStreamDelegate(
                requestId: requestId,
                publish: { aggregateEvents.append($0); return true }, isSafe: { _ in true },
                complete: { aggregateCompletions.append($0) }
            )
            aggregateDelegate.urlSession(session, dataTask: aggregateTask, didReceive: response) { _ in }
            var received = 0
            while received + frame.count <= NativeAPIRequestBridge.maximumEventAggregateBytes {
                let frameCount = min(
                    10_000,
                    (NativeAPIRequestBridge.maximumEventAggregateBytes - received) / frame.count
                )
                if frameCount == 0 { break }
                var chunk = Data(capacity: frame.count * frameCount)
                for _ in 0..<frameCount { chunk.append(frame) }
                aggregateDelegate.urlSession(session, dataTask: aggregateTask, didReceive: chunk)
                received += chunk.count
            }
            let remainder = NativeAPIRequestBridge.maximumEventAggregateBytes - received
            if remainder > 0 {
                aggregateDelegate.urlSession(
                    session, dataTask: aggregateTask,
                    didReceive: Data(repeating: 0x3a, count: remainder)
                )
            }
            try require(aggregateEvents.count == 1, "framing-overhead overflow published a decoded event")
            try require(aggregateCompletions.isEmpty, "raw aggregate cancelled before its exact bound")
            aggregateDelegate.urlSession(session, dataTask: aggregateTask, didReceive: Data([0x78]))
            try require(aggregateCompletions.count == 1, failureMessage)
            if case .oversizedResponse? = aggregateCompletions[0] {} else {
                throw FixtureFailure.assertion(failureMessage)
            }
            aggregateDelegate.urlSession(
                session, task: aggregateTask,
                didCompleteWithError: URLError(.cancelled)
            )
            try require(aggregateCompletions.count == 1, "raw-byte overflow emitted multiple terminal results")
            try require(aggregateEvents.count == 1, "raw-byte overflow published a decoded event")
        }

        try proveRawOverflow(
            frame: Data(":x\n\n".utf8), requestId: "comment-overflow",
            failureMessage: "comment-only raw-byte overflow was not cancelled"
        )
        try proveRawOverflow(
            frame: Data(":\r\n\r\n".utf8), requestId: "framing-overflow",
            failureMessage: "framing-overhead raw-byte overflow was not cancelled"
        )
    }
}
