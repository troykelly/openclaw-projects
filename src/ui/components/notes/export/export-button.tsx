/**
 * Export / Download button for notes and notebooks (#2479).
 *
 * Renders a toolbar-style button that opens a format picker dropdown.
 * On format selection, triggers an export and polls for completion.
 * When ready, auto-triggers the browser download via the presigned URL.
 */

import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2, CheckCircle2, XCircle } from 'lucide-react';
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
import type { ExportFormat, ExportSourceType } from '@/ui/lib/api-types';

const S = NAMESPACE_STRINGS.export;

const FORMATS: { value: ExportFormat; label: string; description: string }[] = [
  { value: 'pdf', label: S.format.pdf.label, description: S.format.pdf.description },
  { value: 'docx', label: S.format.docx.label, description: S.format.docx.description },
  { value: 'odf', label: S.format.odf.label, description: S.format.odf.description },
];

export interface ExportButtonProps {
  sourceType: ExportSourceType;
  sourceId: string;
  sourceName: string;
  disabled?: boolean;
}

export function ExportButton({ sourceType, sourceId, sourceName, disabled }: ExportButtonProps) {
  const [activeExportId, setActiveExportId] = useState<string | null>(null);
  const createExport = useCreateExport();
  const { data: exportStatus } = useExportStatus(activeExportId);

  const isExporting = createExport.isPending || (activeExportId !== null && exportStatus?.status !== 'ready' && exportStatus?.status !== 'failed' && exportStatus?.status !== 'expired');

  // Handle export completion
  useEffect(() => {
    if (!exportStatus || !activeExportId) return;

    if (exportStatus.status === 'ready' && exportStatus.download_url) {
      // Trigger browser download
      const a = document.createElement('a');
      a.href = exportStatus.download_url;
      a.download = exportStatus.original_filename || `${sourceName}.${exportStatus.format}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      toast.success(S.progress.ready);
      setActiveExportId(null);
    } else if (exportStatus.status === 'failed') {
      toast.error(exportStatus.error_message || S.progress.failed);
      setActiveExportId(null);
    } else if (exportStatus.status === 'expired') {
      toast.error(S.progress.expired);
      setActiveExportId(null);
    }
  }, [exportStatus, activeExportId, sourceName]);

  const handleFormatSelect = useCallback(
    (format: ExportFormat) => {
      createExport.mutate(
        { sourceType, sourceId, format },
        {
          onSuccess: (data) => {
            if (data.status === 'ready' && data.download_url) {
              // Sync export — download immediately
              const a = document.createElement('a');
              a.href = data.download_url;
              a.download = data.original_filename || `${sourceName}.${format}`;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              toast.success(S.progress.ready);
            } else {
              // Async export — start polling
              setActiveExportId(data.id);
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
