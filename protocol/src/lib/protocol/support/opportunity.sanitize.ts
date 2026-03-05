/**
 * Strips UUID patterns from user-facing text to prevent internal ID leaks.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function stripUuids(text: string): string {
  return text
    .replace(/\(([^)]*)\)/g, (_match, inner: string) => {
      if (!UUID_PATTERN.test(inner)) {
        UUID_PATTERN.lastIndex = 0;
        return _match;
      }
      UUID_PATTERN.lastIndex = 0;
      const cleaned = inner
        .replace(UUID_PATTERN, '')
        .replace(/,\s*,/g, ',')
        .replace(/\b(?:from|and)\b/gi, '')
        .replace(/^[\s,]+|[\s,]+$/g, '');
      return cleaned ? `(${cleaned})` : '';
    })
    .replace(UUID_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Strips introducer mentions from opportunity summary text.
 * Removes patterns like:
 * - "[Introducer] introduced you to [Counterpart]"
 * - "[Introducer] thinks you should meet [Counterpart]"
 * - "[Introducer] connected you to [Counterpart]"
 * - "[Introducer] suggested you meet [Counterpart]"
 *
 * @param text - The text to clean (personalizedSummary)
 * @param introducerName - Full name of the introducer to strip
 * @returns Text with introducer mentions removed, counterpart preserved
 */
export function stripIntroducerMentions(
  text: string,
  introducerName: string | undefined,
): string {
  if (!introducerName?.trim()) return text;

  const fullName = introducerName.trim();
  const firstName = fullName.split(/\s+/)[0];
  const namesToCheck = [fullName];
  if (firstName && firstName.length > 1) {
    namesToCheck.push(firstName);
  }

  let result = text;

  for (const [idx, name] of namesToCheck.entries()) {
    const escapedName = escapeRegex(name);

    // Pattern: "Name introduced you to " (with or without comma, optionally with "directly")
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+introduced\\s+you\\s+(?:directly\\s+)?to\\s*`, "gi"),
      "",
    );

    // Pattern: "Name thinks you should meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+thinks\\s+you\\s+should\\s+meet\\s*`, "gi"),
      "",
    );

    // Pattern: "Name connected you to "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+connected\\s+you\\s+(?:to|with)\\s*`, "gi"),
      "",
    );

    // Pattern: "Name suggested you meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+suggested\\s+you\\s+(?:meet|connect\\s+(?:to|with))\\s*`, "gi"),
      "",
    );

    // Pattern: "Name recommended you meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+recommended\\s+you\\s+(?:meet|connect)\\s*`, "gi"),
      "",
    );

    // Pattern: "Name thinks you and Counterpart should meet" -> remove entire phrase up to Counterpart
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+thinks\\s+you\\s+and\\s+`, "gi"),
      "",
    );

    // Pattern: "Name also thought..." - remove sentences starting with Name + also/also thought
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+(?:also\\s+)?(?:thought|thinks?|believes?|felt)\\s*`, "gi"),
      "",
    );

    // General: Remove any remaining standalone mention of the introducer name at sentence start.
    // Only apply for fullName (idx === 0) to avoid stripping valid counterpart first names
    // (e.g. "David Smith" intro to "David Johnson" → we strip "David Smith" but not "David" in "David Johnson").
    if (idx === 0) {
      result = result.replace(
        new RegExp(`(?:^|\\.\\s*)\\b${escapedName}\\s+`, "gi"),
        (match, offset) => {
          if (offset === 0 || match.startsWith(".")) {
            return match.startsWith(".") ? ". " : "";
          }
          return match;
        },
      );
    }
  }

  // Clean up: remove leading/trailing whitespace and common punctuation artifacts
  result = result
    .replace(/^[\,\s]+/, "") // Remove leading commas/spaces
    .replace(/\s{2,}/g, " ") // Normalize multiple spaces
    .trim();

  // Capitalize first letter if we removed from start
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result;
}

// Helper function
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
