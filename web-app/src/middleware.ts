import { NextResponse } from "next/server";

export function middleware(request: Request) {
  const url = new URL(request.url);
  const { origin, pathname } = url;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-url", request.url);
  requestHeaders.set("x-origin", origin);
  requestHeaders.set("x-pathname", pathname);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
