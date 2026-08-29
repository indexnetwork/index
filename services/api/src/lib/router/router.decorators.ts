import { log } from '../log';

const logger = log.lib.from('RouteRegistry');

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

// Validation guard signature
export type Guard = (req: Request) => Promise<unknown>;

export interface RouteDefinition {
  path: string;
  method: Method;
  methodName: string | symbol;
}

/** A controller class: the registry only uses it as a key and reads `.name`. */
export type ControllerClass = (abstract new (...args: never[]) => object) & { readonly name: string };

export interface ControllerDefinition {
  path: string;
  target: ControllerClass;
}

export class RouteRegistry {
  private static routes: Map<ControllerClass, RouteDefinition[]> = new Map();
  private static controllers: Map<ControllerClass, ControllerDefinition> = new Map();
  private static guards: Map<ControllerClass, Map<string | symbol, Guard[]>> = new Map();

  static registerController(target: ControllerClass, path: string) {
    this.controllers.set(target, { path, target });
    logger.info('Controller registered', { controller: target.name, path });
  }

  static registerRoute(target: object, method: Method, path: string, methodName: string | symbol) {
    const constructor = target.constructor as ControllerClass;
    if (!this.routes.has(constructor)) {
      this.routes.set(constructor, []);
    }
    const routes = this.routes.get(constructor)!;
    routes.push({ path, method, methodName });
    logger.debug('Route registered', {
      controller: constructor.name,
      method,
      path: path || '/',
      handler: String(methodName),
    });
  }

  static registerGuard(target: object, methodName: string | symbol, guard: Guard) {
    const constructor = target.constructor as ControllerClass;
    if (!this.guards.has(constructor)) {
      this.guards.set(constructor, new Map());
    }
    const methodGuards = this.guards.get(constructor)!;
    if (!methodGuards.has(methodName)) {
      methodGuards.set(methodName, []);
    }
    methodGuards.get(methodName)!.push(guard);
    logger.debug('Guard registered', {
      controller: constructor.name,
      method: String(methodName),
      guard: guard.name || 'anonymous',
    });
  }

  static getControllers() {
    return this.controllers;
  }

  static getRoutes(target: ControllerClass) {
    return this.routes.get(target) || [];
  }

  static getGuards(target: ControllerClass, methodName: string | symbol): Guard[] {
    const constructorGuards = this.guards.get(target);
    if (!constructorGuards) return [];
    return constructorGuards.get(methodName) || [];
  }
}

export function Controller(prefix: string = ''): ClassDecorator {
  return (target) => {
    RouteRegistry.registerController(target as unknown as ControllerClass, prefix);
  };
}

function createMethodDecorator(method: Method) {
  return (path: string = ''): MethodDecorator => {
    return (target: object, propertyKey: string | symbol) => {
      RouteRegistry.registerRoute(target, method, path, propertyKey);
    };
  };
}

export const Post = createMethodDecorator('POST');
export const Get = createMethodDecorator('GET');
export const Put = createMethodDecorator('PUT');
export const Delete = createMethodDecorator('DELETE');
export const Patch = createMethodDecorator('PATCH');

export function UseGuards(...guards: Guard[]): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    for (const guard of guards) {
      RouteRegistry.registerGuard(target, propertyKey, guard);
    }
  };
}
