import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { TOKEN_NAME } from './lib/auth';

// Public routes that don't require authentication
const publicRoutes = ['/', '/login', '/signup', '/docs'];

export function middleware(request: NextRequest) {
  // Get auth token from cookies
  const authToken = request.cookies.get(TOKEN_NAME)?.value;
  const isAuthenticated = !!authToken;
  
  // Get the path from the request URL
  const path = request.nextUrl.pathname;
  
  // Check if the current path is a public route
  const isPublicRoute = publicRoutes.some(route => path === route);

  // If authenticated and trying to access a public route (except docs), redirect to app
  if (isAuthenticated && isPublicRoute && path !== '/docs') {
    return NextResponse.redirect(new URL('/indexes', request.url));
  }

  // If not authenticated and trying to access a protected route, redirect to home
  if (!isAuthenticated && !isPublicRoute && !path.startsWith('/_next')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

// Match all routes except static assets, api routes, etc.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (fonts, images, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}; 