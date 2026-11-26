/**
 * Where a network lives: index.network/<key> once its owner has named it,
 * /networks/<id> until then. Linking straight to the key skips the redirect
 * the id page does when it finds one.
 */
export function networkPath(network: { id: string; key?: string | null }, tab?: string): string {
  const base = network.key ? `/${network.key}` : `/networks/${network.id}`;
  return tab ? `${base}/${tab}` : base;
}
