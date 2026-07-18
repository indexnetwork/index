import { getRequestAuthContext } from '../request-auth-context';
import { log } from '../log';

const logger = log.route.from('deprecation');

function addDeprecationHeader(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Deprecation', 'true');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Mark a controller handler as deprecated without changing its response body or status.
 * Each invocation emits one structured warning and adds `Deprecation: true` to the response.
 *
 * @param routeId - Stable identifier used to aggregate route hits across parameterized paths
 * @returns Method decorator for a controller route handler
 */
export function deprecatedRoute(routeId: string): MethodDecorator {
  return (_target: object, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as ((...args: unknown[]) => unknown) | undefined;
    if (!original) throw new Error(`@deprecatedRoute(${routeId}) requires a method`);

    descriptor.value = async function (this: object, ...args: unknown[]): Promise<unknown> {
      const req = args[0];
      if (!(req instanceof Request)) {
        return Reflect.apply(original, this, args);
      }

      const authContext = getRequestAuthContext(req);
      logger.warn('Deprecated API route used', {
        event: 'deprecated_route_used',
        routeId,
        method: req.method,
        path: new URL(req.url, 'http://localhost').pathname,
        authKind: authContext?.kind ?? 'anonymous',
        ...(authContext?.kind === 'api_key' && authContext.agentId
          ? { agentId: authContext.agentId }
          : {}),
      });

      const response = await Reflect.apply(original, this, args);
      return response instanceof Response ? addDeprecationHeader(response) : response;
    };
  };
}
