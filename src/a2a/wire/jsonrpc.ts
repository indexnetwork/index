export interface JsonRpcRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: "2.0";
  id: string;
  result: R;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | null;
  error: { code: number; message: string };
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcError;

export function isJsonRpcError(response: JsonRpcResponse): response is JsonRpcError {
  return "error" in response;
}
