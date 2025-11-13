'use client';

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useIntegrationsService } from '@/services/integrations';

interface DirectoryConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: {
    id: string;
    type: 'notion' | 'airtable' | 'googledocs';
    name: string;
  };
  onSuccess?: () => void;
}

interface Source {
  id: string;
  name: string;
  subSources?: Array<{ id: string; name: string }>;
}

interface Column {
  id: string;
  name: string;
  type?: string;
}

type Step = 'source' | 'subSource' | 'mapping' | 'confirm';

export default function DirectoryConfigModal({
  open,
  onOpenChange,
  integration,
  onSuccess
}: DirectoryConfigModalProps) {
  const [step, setStep] = useState<Step>('source');
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSource, setSelectedSource] = useState<Source | null>(null);
  const [selectedSubSource, setSelectedSubSource] = useState<{ id: string; name: string } | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [columnMappings, setColumnMappings] = useState<{
    email: string;
    name?: string;
    intro?: string;
    location?: string;
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  }>({ email: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { success, error } = useNotifications();
  const integrationsService = useIntegrationsService();

  const needsSubSource = integration.type === 'airtable' || integration.type === 'googledocs';

  useEffect(() => {
    if (open && step === 'source') {
      loadSources();
    }
  }, [open, step]);

  const loadSources = async () => {
    setLoading(true);
    try {
      const response = await integrationsService.getDirectorySources(integration.id);
      setSources(response.sources);
    } catch (err) {
      console.error('Failed to load sources:', err);
      error('Failed to load sources');
    } finally {
      setLoading(false);
    }
  };

  const handleSourceSelect = async (source: Source) => {
    setSelectedSource(source);
    if (needsSubSource && source.subSources && source.subSources.length > 0) {
      setStep('subSource');
    } else {
      await loadSchema(source.id);
    }
  };

  const handleSubSourceSelect = async (subSource: { id: string; name: string }) => {
    setSelectedSubSource(subSource);
    if (selectedSource) {
      await loadSchema(selectedSource.id, subSource.id);
    }
  };

  const loadSchema = async (sourceId: string, subSourceId?: string) => {
    setLoading(true);
    try {
      const response = await integrationsService.getDirectorySourceSchema(
        integration.id,
        sourceId,
        subSourceId
      );
      setColumns(response.columns);
      
      // Auto-detect mappings
      const autoMappings = detectColumnMappings(response.columns);
      setColumnMappings({
        email: autoMappings.email || '',
        name: autoMappings.name,
        intro: autoMappings.intro,
        location: autoMappings.location,
        twitter: autoMappings.twitter,
        linkedin: autoMappings.linkedin,
        github: autoMappings.github,
        website: autoMappings.website
      });
      
      setStep('mapping');
    } catch (err) {
      console.error('Failed to load schema:', err);
      error('Failed to load schema');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!columnMappings.email || !selectedSource) {
      error('Please map the email column');
      return;
    }

    setSaving(true);
    try {
      const config = {
        source: {
          id: selectedSource.id,
          name: selectedSource.name,
          ...(selectedSubSource && {
            subId: selectedSubSource.id,
            subName: selectedSubSource.name
          })
        },
        columnMappings
      };

      await integrationsService.saveDirectoryConfig(integration.id, config);
      success('Directory sync configured successfully');
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save config:', err);
      error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setStep('source');
      setSelectedSource(null);
      setSelectedSubSource(null);
      setColumns([]);
      setColumnMappings({ email: '' });
      onOpenChange(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[600px] bg-white border border-gray-200 rounded-lg p-6 shadow-xl focus:outline-none animate-in fade-in zoom-in-95 duration-200 z-50 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <Dialog.Title className="text-lg font-bold text-black font-ibm-plex-mono">
              Configure Directory Sync
            </Dialog.Title>
            <button
              onClick={handleClose}
              disabled={saving}
              className="rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 disabled:opacity-50"
            >
              <X className="h-4 w-4 text-gray-600" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          {step === 'source' && (
            <div className="space-y-4">
              <p className="text-sm text-black font-ibm-plex-mono">
                Select a {integration.type === 'airtable' ? 'base' : integration.type === 'notion' ? 'database' : 'spreadsheet'}
              </p>
              {loading ? (
                <div className="text-center py-8">
                  <div className="h-8 w-8 border-2 border-gray-300 border-t-black rounded-full animate-spin mx-auto" />
                </div>
              ) : (
                <div className="space-y-2">
                  {sources.map((source) => (
                    <button
                      key={source.id}
                      onClick={() => handleSourceSelect(source)}
                      className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-ibm-plex-mono text-black"
                    >
                      {source.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'subSource' && selectedSource && (
            <div className="space-y-4">
              <p className="text-sm text-black font-ibm-plex-mono">
                Select a {integration.type === 'airtable' ? 'table' : 'sheet'}
              </p>
              <div className="space-y-2">
                {selectedSource.subSources?.map((subSource) => (
                  <button
                    key={subSource.id}
                    onClick={() => handleSubSourceSelect(subSource)}
                    className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-ibm-plex-mono text-black"
                  >
                    {subSource.name}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                onClick={() => setStep('source')}
                className="font-ibm-plex-mono"
              >
                Back
              </Button>
            </div>
          )}

          {step === 'mapping' && (
            <div className="space-y-4">
              <p className="text-sm text-black font-ibm-plex-mono mb-4">
                Map columns to member fields
              </p>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-black mb-1 font-ibm-plex-mono">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={columnMappings.email}
                    onChange={(e) => setColumnMappings({ ...columnMappings, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md font-ibm-plex-mono text-black"
                  >
                    <option value="">Select column</option>
                    {columns.map((col) => (
                      <option key={col.id} value={col.name} className="text-black">
                        {col.name}
                      </option>
                    ))}
                  </select>
                </div>

                {[
                  { key: 'name', label: 'Name' },
                  { key: 'intro', label: 'Intro' },
                  { key: 'location', label: 'Location' },
                  { key: 'twitter', label: 'Twitter/X' },
                  { key: 'linkedin', label: 'LinkedIn' },
                  { key: 'github', label: 'GitHub' },
                  { key: 'website', label: 'Website' }
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-black mb-1 font-ibm-plex-mono">
                      {label}
                    </label>
                    <select
                      value={columnMappings[key as keyof typeof columnMappings] || ''}
                      onChange={(e) => setColumnMappings({ ...columnMappings, [key]: e.target.value || undefined })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md font-ibm-plex-mono text-black"
                    >
                      <option value="" className="text-black">None</option>
                      {columns.map((col) => (
                        <option key={col.id} value={col.name} className="text-black">
                          {col.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Show unmapped columns that will become metadata */}
              {(() => {
                const mappedColumns = [
                  columnMappings.email,
                  columnMappings.name,
                  columnMappings.intro,
                  columnMappings.location,
                  columnMappings.twitter,
                  columnMappings.linkedin,
                  columnMappings.github,
                  columnMappings.website
                ].filter(Boolean) as string[];
                
                const unmappedColumns = columns.filter(col => !mappedColumns.includes(col.name));
                
                if (unmappedColumns.length > 0) {
                  return (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs font-medium text-black font-ibm-plex-mono mb-2">
                        Additional fields (will become metadata):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {unmappedColumns.map((col) => (
                          <span
                            key={col.id}
                            className="text-xs px-2 py-1 bg-white border border-blue-200 rounded font-ibm-plex-mono text-black"
                          >
                            {col.name}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-black font-ibm-plex-mono mt-2 italic">
                        These fields will be stored as member-specific metadata in this index
                      </p>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setStep(needsSubSource ? 'subSource' : 'source')}
                  className="font-ibm-plex-mono"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!columnMappings.email || saving}
                  className="font-ibm-plex-mono"
                >
                  {saving ? 'Saving...' : 'Save Configuration'}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Helper function for auto-detection
function detectColumnMappings(columns: Column[]): Partial<{
  email: string;
  name?: string;
  intro?: string;
  location?: string;
  twitter?: string;
  linkedin?: string;
  github?: string;
  website?: string;
}> {
  const mappings: any = {};
  const columnNames = columns.map(c => c.name.toLowerCase());
  const usedColumns = new Set<string>();

  const emailPatterns = ['email', 'e-mail', 'e_mail', 'mail'];
  for (const pattern of emailPatterns) {
    const idx = columnNames.findIndex(name => name.includes(pattern));
    if (idx !== -1) {
      mappings.email = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  const namePatterns = ['name', 'full name', 'fullname'];
  for (const pattern of namePatterns) {
    const idx = columnNames.findIndex((name, i) => (name === pattern || name.includes(pattern)) && !usedColumns.has(columns[i]?.name));
    if (idx !== -1 && !usedColumns.has(columns[idx].name)) {
      mappings.name = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  const introPatterns = ['bio', 'intro', 'introduction', 'about', 'description'];
  for (const pattern of introPatterns) {
    const idx = columnNames.findIndex((name, i) => name.includes(pattern) && !usedColumns.has(columns[i]?.name));
    if (idx !== -1 && !usedColumns.has(columns[idx].name)) {
      mappings.intro = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  const locationPatterns = ['location', 'city', 'address'];
  for (const pattern of locationPatterns) {
    const idx = columnNames.findIndex((name, i) => name.includes(pattern) && !usedColumns.has(columns[i]?.name));
    if (idx !== -1 && !usedColumns.has(columns[idx].name)) {
      mappings.location = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  const twitterPatterns = ['twitter', 'x', 'x.com'];
  for (const pattern of twitterPatterns) {
    const idx = columnNames.findIndex((name, i) => name.toLowerCase().includes(pattern) && !usedColumns.has(columns[i]?.name));
    if (idx !== -1 && !usedColumns.has(columns[idx].name)) {
      mappings.twitter = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  const linkedinPatterns = ['linkedin', 'linked-in'];
  for (const pattern of linkedinPatterns) {
    const idx = columnNames.findIndex((name, i) => name.toLowerCase().includes(pattern) && !usedColumns.has(columns[i]?.name));
    if (idx !== -1 && !usedColumns.has(columns[idx].name)) {
      mappings.linkedin = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  const githubPatterns = ['github', 'git'];
  for (const pattern of githubPatterns) {
    const idx = columnNames.findIndex((name, i) => name.toLowerCase().includes(pattern) && !usedColumns.has(columns[i]?.name));
    if (idx !== -1 && !usedColumns.has(columns[idx].name)) {
      mappings.github = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  const websitePatterns = ['website', 'url', 'link', 'homepage'];
  for (const pattern of websitePatterns) {
    const idx = columnNames.findIndex((name, i) => name.toLowerCase().includes(pattern) && !usedColumns.has(columns[i]?.name));
    if (idx !== -1 && !usedColumns.has(columns[idx].name)) {
      mappings.website = columns[idx].name;
      usedColumns.add(columns[idx].name);
      break;
    }
  }

  return mappings;
}

