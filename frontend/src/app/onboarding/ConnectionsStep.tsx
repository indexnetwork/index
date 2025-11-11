"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IntegrationState, OnboardingStep } from "@/types/onboarding";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useIntegrationsService } from "@/services/integrations";
import { IntegrationName, getIntegrationsList } from "@/config/integrations";
import { validateFiles, getSupportedFileExtensions, formatFileSize, getFileCategoryBadge } from "@/lib/file-validation";
import { useFiles, useLinks } from "@/contexts/APIContext";
import { QueueStatus } from "@/services/queue";
import { formatDate } from "@/lib/utils";
import { useOnboardingContext } from "@/contexts/OnboardingContext";
import Integration from "./components/Integration";

interface ConnectionsStepProps {
  handleCompleteOnboarding: () => void;
}

export default function ConnectionsStep({
  handleCompleteOnboarding,
}: ConnectionsStepProps) {
  const { flowConfig, createdIndex, setCurrentStep, getNextStep, getPreviousStep } = useOnboardingContext();
  // Connections step states
  const [integrations, setIntegrations] = useState<IntegrationState[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [, setIntegrationsIndexId] = useState<string | undefined>(undefined);
  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);
  const [queueStatus] = useState<QueueStatus | null>(null);

  // File and link states
  const [linkUrl, setLinkUrl] = useState("");
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string; name: string; size: string; type: string; createdAt?: string }>>([]);
  const [links, setLinks] = useState<Array<{ id: string; url: string; createdAt?: string }>>([]);

  // Services and hooks
  const integrationsService = useIntegrationsService();
  const filesService = useFiles();
  const linksService = useLinks();
  const { success, error } = useNotifications();
  const { user } = useAuthContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const availableIntegrations = integrations
    .filter((integration) => {
      // Filter out Slack/Discord if not enabled for this flow
      if (!flowConfig.features.showSlackDiscord && (integration.type === 'slack' || integration.type === 'discord')) {
        return false;
      }
      return true;
    })
  // Load integrations status
  const loadIntegrations = useCallback(async () => {
    try {
      // Determine if we should filter by indexId based on flow config
      let queryIndexId: string | undefined;
      if (flowConfig.features.requireIndexId) {
        queryIndexId =
          user?.onboarding?.indexId || createdIndex?.id || undefined;
      }

      const response = await integrationsService.getIntegrations(queryIndexId);

      const connectedIntegrations = response.integrations || [];
      const availableTypes = response.availableTypes || [];

      // Create integration state combining connected and available types
      const updatedIntegrations = availableTypes.map(availableType => {
        const connectedIntegration = connectedIntegrations.find(i => i.type === availableType.type);
        return {
          id: connectedIntegration?.id || null, // The actual UUID
          type: availableType.type as IntegrationName, // The integration type
          name: availableType.name,
          connected: !!connectedIntegration,
          indexId: connectedIntegration?.indexId || null
        };
      });

      setIntegrations(updatedIntegrations);
      setIntegrationsLoaded(true);
      setIntegrationsIndexId(queryIndexId);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      // Fallback to default integrations if API fails
      setIntegrations(getIntegrationsList());
      setIntegrationsLoaded(true);
      setIntegrationsIndexId(undefined);
    }
  }, [
    integrationsService,
    createdIndex?.id,
    user?.onboarding?.indexId,
    flowConfig.features.requireIndexId,
  ]);

  // Load integrations on mount
  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  const toggleIntegration = useCallback(
    async (type: string) => {
      const item = integrations.find((i) => i.type === type);
      if (!item) return;

      try {
        setPendingIntegration(type);
        if (item.connected && item.id) {
          // Disconnect using integration UUID
          await integrationsService.disconnectIntegration(item.id);
          // Refresh integrations from API to get real status
          await loadIntegrations();

          success(`${item.name} disconnected`);
          
          return;
        }

        const popup =
          typeof window !== "undefined"
            ? window.open("", `oauth_${type}`, "width=560,height=720")
            : null;

        // Build payload based on flow configuration
        const payload: { indexId?: string; enableUserAttribution: boolean } =
          {
            enableUserAttribution: flowConfig.features.enableUserAttribution,
          };

        if (flowConfig.features.requireIndexId) {
          const indexId = user?.onboarding?.indexId || createdIndex?.id;
          if (!indexId) {
            error("Index ID is required to connect integrations");
            return;
          }
          payload.indexId = indexId;
        }

        const res = await integrationsService.connectIntegration(
          type,
          payload
        );
        const redirect = res.redirectUrl;
        const integrationId = res.integrationId;

        if (popup && redirect) {
          popup.location.href = redirect;
        } else if (redirect) {
          window.location.href = redirect;
          return;
        }

        if (!integrationId) {
          return
        }
        
        const started = Date.now();

        const poll = setInterval(async () => {
          if (popup && popup.closed) {
            clearInterval(poll);
            return;
          }

          try {
            // Use the new status endpoint with integrationId
            const s = await integrationsService.getIntegrationStatus(
              integrationId
            );

            if (s.status === "connected") {
              clearInterval(poll);
              if (popup && !popup.closed) popup.close();
              // Refresh integrations from API to get real status
              await loadIntegrations();
              success(`${item.name} connected`);
            }
            if (Date.now() - started > 90000) {
              clearInterval(poll);
              if (popup && !popup.closed) popup.close();
              error("Connection timeout - please try again");
            }
          } catch (err) {
            console.error("Error checking connection status:", err);
          }
        }, 1500);
      } catch {
        // ignore
      } finally {
        setPendingIntegration(null);
      }
    },
    [
      integrationsService,
      integrations,
      success,
      error,
      flowConfig.features.enableUserAttribution,
      flowConfig.features.requireIndexId,
      loadIntegrations,
      createdIndex?.id,
      user?.onboarding?.indexId,
    ]
  );

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;

    // Validate files before uploading
    const files = Array.from(f);
    const validation = validateFiles(files, 'general');
    if (!validation.isValid) {
      error(validation.message || 'Invalid file');
      return;
    }

    setIsUploading(true);
    try {
      const uploadedFiles = await Promise.all(files.map(async (file: File) => {
        return await filesService.uploadFile(file);
      }));
      setFiles(prev => [...prev, ...uploadedFiles.map(f => ({
        id: f.id,
        name: f.name,
        size: String(f.size),
        type: f.type,
        createdAt: f.createdAt || new Date().toISOString()
      }))]);
      success(`${uploadedFiles.length} file(s) uploaded`);
    } catch {
      error('Failed to upload files');
    } finally {
      setIsUploading(false);
    }
  }, [filesService, success, error]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrl.trim()) return;

    let normalizedUrl = linkUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    try {
      setIsAddingLink(true);
      const link = await linksService.createLink(normalizedUrl);
      setLinks(prev => [...prev, {
        id: link.id,
        url: link.url,
        createdAt: link.createdAt || new Date().toISOString()
      }]);
      setLinkUrl("");
      success('Link added successfully');
    } catch {
      error('Failed to add link');
    } finally {
      setIsAddingLink(false);
    }
  }, [linksService, linkUrl, success, error]);

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      try {
        await filesService.deleteFile(fileId);
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        success("File deleted");
      } catch {
        error("Failed to delete file");
      }
    },
    [filesService, success, error]
  );

  const handleDeleteLink = useCallback(
    async (linkId: string) => {
      try {
        await linksService.deleteLink(linkId);
        setLinks((prev) => prev.filter((l) => l.id !== linkId));
        success("Link deleted");
      } catch {
        error("Failed to delete link");
      }
    },
    [linksService, success, error]
  );

  const nextStep = getNextStep(OnboardingStep.Connections);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">Connect your context</h1>
        <p className="text-black text-[14px] font-ibm-plex-mono mb-6">
          Help Index understand what you're working on and looking for by connecting your accounts and sharing relevant content.
        </p>

        {/* Queue Status */}
        {queueStatus?.generateIntents && ((queueStatus.generateIntents.pending ?? 0) > 0 || (queueStatus.generateIntents.active ?? 0) > 0) && (
          <div className="mb-3 text-[10px] font-ibm-plex-mono text-[#666] bg-[#F8F9FA] px-2 py-1.5 rounded-sm border border-[#E0E0E0]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1">
                {(queueStatus.generateIntents.active ?? 0) > 0 && (
                  <span className="h-1.5 w-1.5 bg-[#0A8F5A] rounded-full animate-pulse"></span>
                )}
                Generating Intents
              </span>
              <span className="font-medium">
                {(queueStatus.generateIntents.active ?? 0) > 0 && (
                  `${queueStatus.generateIntents.active} task${queueStatus.generateIntents.active === 1 ? '' : 's'} active`
                )}
                {(queueStatus.generateIntents.active ?? 0) > 0 && (queueStatus.generateIntents.pending ?? 0) > 0 && ' • '}
                {(queueStatus.generateIntents.pending ?? 0) > 0 && (
                  `${queueStatus.generateIntents.pending} task${queueStatus.generateIntents.pending === 1 ? '' : 's'} pending`
                )}
              </span>
            </div>
          </div>
        )}

        <h2 className="text-lg font-bold text-black font-ibm-plex-mono">Connect accounts</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {availableIntegrations.map((integration) => (
          <Integration
            key={integration.type}
            integration={integration}
            integrationsLoaded={integrationsLoaded}
            pendingIntegration={pendingIntegration}
            onToggle={toggleIntegration}
          />
        ))}
      </div>

      <div className="mb-2">
        <h2 className="text-lg font-bold text-black mb-2 font-ibm-plex-mono">
          Add from files & web
        </h2>

        <p className="text-black text-[14px] font-ibm-plex-mono mb-6">
          Upload documents or add links to content that represents your work and interests—like research notes, articles, proposals, or blog posts.
        </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
            {/* File upload */}
            <div className="border border-[#E0E0E0] rounded-sm">
              <div className="relative w-full">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  id="onboarding-file-upload"
                  accept={getSupportedFileExtensions('general')}
                  onChange={(e) => handleFilesSelected(e.target.files)}
                  aria-label="Upload files"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full h-10 px-3 py-2 text-sm font-ibm-plex-mono bg-white text-[#333] hover:bg-[#F0F0F0] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 rounded-sm flex items-center justify-center gap-1.5"
                >
                  {isUploading ? (
                    <>
                      <span className="h-4 w-4 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                        <path d="M12 5v14"></path>
                        <path d="M5 12h14"></path>
                      </svg>
                      Upload files
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Link input */}
            <div className="border border-[#E0E0E0] rounded-sm">
              <div className="relative w-full">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-sm pointer-events-none">
                  🔗
                </span>
                <Input
                  placeholder="Paste URL here"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddLink(); }}
                  className="text-sm bg-white rounded-sm font-ibm-plex-mono w-full pl-10 pr-10 focus:ring-2 focus:ring-[rgba(0,0,0,0.1)] border-0"
                />
                {isAddingLink ? (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-6 h-6 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <button
                    onClick={handleAddLink}
                    disabled={!linkUrl}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                    aria-label="Add URL"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>

          {(files.length > 0 || links.length > 0) && (
            <div className="space-y-2 pt-3 max-h-[300px] overflow-y-auto">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group w-full border rounded-sm px-2.5 py-2 transition-colors md:px-3 border-[#E0E0E0] bg-white hover:border-[#CCCCCC]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-[10px] px-1.5 py-0.5 border border-[#E0E0E0] rounded-sm font-ibm-plex-mono text-[#333] bg-[#F5F5F5]">
                        {getFileCategoryBadge(file.name, file.type)}
                      </span>
                      <span className="text-sm text-[#333] truncate font-medium">{file.name}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        className="group p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                        onClick={() => handleDeleteFile(file.id)}
                        aria-label="Delete file"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#333] transition-colors duration-150 ease-in-out">
                          <polyline points="3,6 5,6 21,6"></polyline>
                          <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-[#666] mt-1 truncate font-ibm-plex-mono">
                    {formatFileSize(typeof file.size === 'bigint' ? Number(file.size) : (typeof file.size === 'string' ? parseInt(file.size) : file.size))} • {file.createdAt ? formatDate(file.createdAt).split(',')[0] : 'Recently added'}
                  </div>
                </div>
              ))}
              {links.map((link) => (
                <div
                  key={link.id}
                  className="group w-full border rounded-sm px-2.5 py-2 transition-colors md:px-3 border-[#E0E0E0] bg-white hover:border-[#CCCCCC]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="flex-shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                      </div>
                      <span className="text-sm text-[#333] truncate font-medium">{link.url}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        className="group p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                        onClick={() => handleDeleteLink(link.id)}
                        aria-label="Delete link"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#333] transition-colors duration-150 ease-in-out">
                          <polyline points="3,6 5,6 21,6"></polyline>
                          <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                          <line x1="10" y1="11" x2="10" y2="17"></line>
                          <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-[#666] mt-1 truncate font-ibm-plex-mono">
                    {link.createdAt ? formatDate(link.createdAt) : 'Recently added'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      <div className="flex gap-3 mt-6">
        <Button
          variant="outline"
          onClick={() => setCurrentStep(getPreviousStep(OnboardingStep.Connections))}
          className="flex-1 border-[#E0E0E0] text-black hover:bg-[#F0F0F0] font-ibm-plex-mono"
        >
          Back
        </Button>
        <Button
          onClick={() => {
            // If this is the last step, complete onboarding
            if (nextStep === OnboardingStep.Connections) {
              handleCompleteOnboarding();
            } else {
              setCurrentStep(nextStep);
            }
          }}
          className="flex-1 bg-[#000] text-white hover:bg-black font-ibm-plex-mono"
        >
          {nextStep === OnboardingStep.Connections ? 'Complete Onboarding' : 'Next'}
        </Button>

      </div>
    </div>
  );
}
