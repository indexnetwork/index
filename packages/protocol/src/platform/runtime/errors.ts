/** A stable access error a host can map without importing protocol internals. */
export class ChatContextAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: "USER_NOT_FOUND" | "NETWORK_NOT_FOUND" | "NETWORK_MEMBERSHIP_REQUIRED",
  ) {
    super(message);
    this.name = "ChatContextAccessError";
  }
}
