/**
 * Maps the internal `intent` domain term to flag-on interactive web language.
 * Apply only to trusted, system-authored presentation fields; user-authored
 * signal text must remain unchanged.
 */
export function toSignalProductLanguage(value: string): string {
  return value.replace(/\bintents?\b/gi, (match) => {
    const replacement = match.toLowerCase() === 'intents' ? 'signals' : 'signal';
    if (match === match.toUpperCase()) return replacement.toUpperCase();
    if (match[0] === match[0]?.toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}
