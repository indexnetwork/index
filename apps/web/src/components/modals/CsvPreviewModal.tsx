import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ImportRow } from '@/lib/csv-import';

interface CsvPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  valid: ImportRow[];
  invalid: { row: Record<string, string>; reason: string }[];
  columns: string[];
  hasEmailColumn: boolean;
  onConfirm: (rows: ImportRow[]) => Promise<void>;
}

export default function CsvPreviewModal({
  open,
  onOpenChange,
  valid,
  invalid,
  columns,
  hasEmailColumn,
  onConfirm,
}: CsvPreviewModalProps) {
  const [isImporting, setIsImporting] = useState(false);

  const allRows = [
    ...valid.map((r) => ({ data: r, invalid: false as const, reason: '' })),
    ...invalid.map((r) => ({ data: r, invalid: true as const, reason: r.reason })),
  ];

  const handleConfirm = async () => {
    setIsImporting(true);
    try {
      await onConfirm(valid);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg w-full max-w-2xl max-h-[80vh] z-[100] focus:outline-none flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <Dialog.Title className="text-lg font-bold text-gray-900">
              Import Preview
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-auto px-6 py-4">
            {!hasEmailColumn ? (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-sm text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                CSV must have an email column
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">#</th>
                      {columns.map((col) => (
                        <th key={col} className="text-left py-2 pr-3 text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                      <th className="text-left py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRows.map((entry, i) => {
                      const rowData = entry.invalid
                        ? entry.data.row
                        : rowToRecord(entry.data as ImportRow);
                      return (
                        <tr
                          key={i}
                          className={entry.invalid ? 'bg-red-50' : 'hover:bg-gray-50'}
                        >
                          <td className="py-1.5 pr-3 text-gray-400 tabular-nums">{i + 1}</td>
                          {columns.map((col) => (
                            <td key={col} className="py-1.5 pr-3 text-gray-700 max-w-[200px] truncate">
                              {rowData[col] || ''}
                            </td>
                          ))}
                          <td className="py-1.5">
                            {entry.invalid ? (
                              <span className="text-xs text-red-600">{entry.reason}</span>
                            ) : (
                              <span className="text-xs text-green-600">Valid</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-900">{valid.length}</span> will be imported
              {invalid.length > 0 && (
                <> · <span className="text-red-600 font-medium">{invalid.length}</span> skipped</>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={isImporting || valid.length === 0 || !hasEmailColumn}
              >
                {isImporting ? 'Importing...' : 'Confirm import'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function rowToRecord(row: ImportRow): Record<string, string> {
  const rec: Record<string, string> = { email: row.email };
  if (row.name) rec['name'] = row.name;
  if (row.bio) rec['bio'] = row.bio;
  if (row.location) rec['location'] = row.location;
  for (const s of row.socials) {
    rec[s.label] = s.value;
  }
  return rec;
}
