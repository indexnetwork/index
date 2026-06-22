import { escapeHtml } from '../../escapeHtml';

export interface ExperimentImportCredential {
  email: string;
  name?: string;
  apiKey: string;
}

export interface ExperimentImportCredentialsParams {
  networkName: string;
  credentials: ExperimentImportCredential[];
}

export interface ExperimentImportCredentialsEmail {
  subject: string;
  html: string;
  text: string;
}

const csvEscape = (v: string): string => {
  if (!v) return '';
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
};

/**
 * Single-email delivery of imported member API keys to the network owner(s).
 * Used by experiment networks in place of per-user invitation emails: the
 * owner receives one CSV containing every minted key and distributes them
 * out-of-band. The plaintext keys are shown once; Index Network retains no
 * recoverable copy.
 */
export const experimentImportCredentialsTemplate = (
  p: ExperimentImportCredentialsParams,
): ExperimentImportCredentialsEmail => {
  const safeNetwork = escapeHtml(p.networkName);
  const subjectName = p.networkName.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 200);
  const count = p.credentials.length;

  const csvLines = ['email,name,api_key'];
  for (const c of p.credentials) {
    csvLines.push([csvEscape(c.email), csvEscape(c.name ?? ''), csvEscape(c.apiKey)].join(','));
  }
  const csv = csvLines.join('\n');
  const safeCsv = escapeHtml(csv);

  return {
    subject: `${count} credential${count === 1 ? '' : 's'} minted for ${subjectName}`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>You just imported <strong>${count}</strong> member${count === 1 ? '' : 's'} into <strong>${safeNetwork}</strong>.</p>
  <p>Each member's API key is listed below. Distribute keys out-of-band — Index Network does not retain a recoverable copy.</p>
  <pre style="font-family: monospace; background: #f6f6f6; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre;">${safeCsv}</pre>
  <p>Treat these keys like passwords. Each key is bound to ${safeNetwork} only.</p>
  <div style="margin-top: 20px; text-align: center;">
    <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
  </div>
</div>`,
    text: `You just imported ${count} member${count === 1 ? '' : 's'} into ${p.networkName}.

Each member's API key is listed below. Distribute keys out-of-band — Index Network does not retain a recoverable copy.

${csv}

Treat these keys like passwords. Each key is bound to ${p.networkName} only.`,
  };
};
