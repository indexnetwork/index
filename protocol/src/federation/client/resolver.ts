export class Resolver {
  constructor(private localBaseUrl: string) {}

  isLocal(entityUrl: string): boolean {
    return entityUrl.startsWith(this.localBaseUrl);
  }

  nodeBaseUrl(entityUrl: string): string {
    const url = new URL(entityUrl);
    return `${url.protocol}//${url.host}`;
  }

  resourcePath(entityUrl: string): string {
    const url = new URL(entityUrl);
    return url.pathname;
  }
}
