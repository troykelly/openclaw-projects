/**
 * Export / Download button for notes and notebooks (#2479).
 *
 * Renders a toolbar-style button that opens a format picker dropdown.
 * On format selection, triggers an export and polls for completion.
 * When ready, auto-triggers the browser download via the presigned URL.
 */

import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/components/ui/tooltip';
import { useCreateExport } from '@/ui/hooks/mutations/use-export-mutations';
import { useExportStatus } from '@/ui/hooks/queries/use-export-status';
import { NAMESPACE_STRINGS } from '@/ui/constants/namespace-strings';
import { ApiRequestError } from '@/ui/lib/api-client';
import type { ExportFormat, ExportSourceType } from '@/ui/lib/api-types';

const S = NAMESPACE_STRINGS.export;

const FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'pdf', label: S.format.pdf.label, description: S.format.pdf.description },
  { value: 'docx', label: S.format.docx.label, description: S.format.docx.description },
  { value: 'odf', label: S.format.odf.label, description: S.format.odf.description },
];

/** Only allow https: (and http: for localhost/loopback dev) download URLs. */
function isSafeDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1')) return true;
    return false;
  } catch {
    return false;
  }
}

/** Trigger a browser download for a validated URL. */
function triggerDownload(url: string, filename: string): void {
  if (!isSafeDownloadUrl(url)) {
    console.error('[ExportButton] Refusing to download unsafe URL:', url);
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export interface ExportButtonProps {
  sourceType: ExportSourceType;
  sourceId: string;
  sourceName: string;
  disabled?: boolean;
}

export function ExportButton({ sourceType, sourceId, sourceName, disabled }: ExportButtonProps) {
  const [pollUrl, setPollUrl] = useState<string | null>(null);
  const createExport = useCreateExport();
  const { data: exportStatus, isError: isPollingError, error: pollingError } = useExportStatus(pollUrl);

  const isExporting = createExport.isPending || (pollUrl !== null && exportStatus?.status !== 'ready' && exportStatus?.status !== 'failed' && exportStatus?.status !== 'expired' && !isPollingError);

  // Handle export completion or polling error
  useEffect(() => {
    if (!pollUrl) return;

    // Polling query failed — check for 410 Gone (expired) vs generic error
    if (isPollingError) {
      if (pollingError instanceof ApiRequestError && pollingError.status === 410) {
        toast.error(S.progress.expired);
      } else {
        toast.error(S.progress.failed);
      }
      setPollUrl(null);
      return;
    }

    if (!exportStatus) return;

    if (exportStatus.status === 'ready' && exportStatus.download_url) {
      const filename = exportStatus.original_filename || `${sourceName}.${exportStatus.format}`;
      triggerDownload(exportStatus.download_url, filename);
      toast.success(S.progress.ready);
      setPollUrl(null);
    } else if (exportStatus.status === 'failed') {
      toast.error(exportStatus.error_message || S.progress.failed);
      setPollUrl(null);
    } else if (exportStatus.status === 'expired') {
      toast.error(S.progress.expired);
      setPollUrl(null);
    }
  }, [exportStatus, pollUrl, sourceName, isPollingError]);

  const handleFormatSelect = useCallback(
    (format: ExportFormat) => {
      createExport.mutate(
        { sourceType, sourceId, format },
        {
          onSuccess: (data) => {
            if (data.status === 'ready' && data.download_url) {
              // Sync export — download immediately
              const filename = data.original_filename || `${sourceName}.${format}`;
              triggerDownload(data.download_url, filename);
              toast.success(S.progress.ready);
            } else if (data.poll_url) {
              // Async export — start polling using server-provided poll_url
              setPollUrl(data.poll_url);
              toast(S.progress.preparing);
            } else {
              // Fallback: construct poll URL from export ID
              setPollUrl(`/exports/${encodeURIComponent(data.id)}`);
              toast(S.progress.preparing);
            }
          },
          onError: () => {
            toast.error(S.progress.failed);
          },
        },
      );
    },
    [sourceType, sourceId, sourceName, createExport],
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <DropdownMenu>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={disabled || isExporting}
                aria-label={isExporting ? S.aria.exportButtonInProgress : S.aria.exportButton(sourceName)}
              >
                {isExporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{S.button.tooltip}</TooltipContent>
          <DropdownMenuContent align="end" aria-label={S.aria.formatPicker}>
            {FORMATS.map((fmt) => (
              <DropdownMenuItem
                key={fmt.value}
                onClick={() => handleFormatSelect(fmt.value)}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{fmt.label}</span>
                  <span className="text-xs text-muted-foreground">{fmt.description}</span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </Tooltip>
    </TooltipProvider>
  );
}
