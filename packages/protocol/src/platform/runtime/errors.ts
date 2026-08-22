/** A stable access error a host can map without importing tool implementation. */
export class ChatContextAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: "USER_NOT_FOUND" | "INDEX_NOT_FOUND" | "INDEX_MEMBERSHIP_REQUIRED",
  ) {
    super(message);
    this.name = "ChatContextAccessError";
  }
}
