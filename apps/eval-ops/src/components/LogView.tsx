import { parseAnsi } from '../lib/ansi';

/**
 * Renders harness output with ANSI colour interpretation.
 *
 * Logs are the untrusted output of a model-driven process: markup is escaped,
 * never rendered. All output is React text nodes, never dangerouslySetInnerHTML.
 */
export function LogView({ text }: { text: string }) {
  const segments = parseAnsi(text);
  return (
    <pre className="whitespace-pre-wrap font-mono text-sm">
      {segments.map((seg, i) => (
        <span key={i} className={seg.className}>
          {seg.text}
        </span>
      ))}
    </pre>
  );
}
