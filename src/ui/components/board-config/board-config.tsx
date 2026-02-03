/**
 * Board Config component
 * Issue #409: Implement board view customization
 */
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { Button } from '@/ui/components/ui/button';
import { ColumnManager } from './column-manager';
import { SwimlanesConfig } from './swimlanes-config';
import { WipLimitsConfig } from './wip-limits-config';
import { CardDisplayConfig } from './card-display-config';
import type {
  BoardColumn,
  SwimlaneSetting,
  WipLimit,
  CardDisplayMode,
  CardField,
} from './types';

export interface BoardConfigProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: BoardColumn[];
  onColumnsChange: (columns: BoardColumn[]) => void;
  swimlanes: SwimlaneSetting | null;
  onSwimlanesChange: (swimlanes: SwimlaneSetting | null) => void;
  wipLimits: Record<string, WipLimit>;
  onWipLimitsChange: (limits: Record<string, WipLimit>) => void;
  cardDisplayMode: CardDisplayMode;
  onCardDisplayModeChange: (mode: CardDisplayMode) => void;
  visibleFields?: CardField[];
  onVisibleFieldsChange?: (fields: CardField[]) => void;
}

export function BoardConfig({
  open,
  onOpenChange,
  columns,
  onColumnsChange,
  swimlanes,
  onSwimlanesChange,
  wipLimits,
  onWipLimitsChange,
  cardDisplayMode,
  onCardDisplayModeChange,
  visibleFields = ['title', 'status', 'priority'],
  onVisibleFieldsChange,
}: BoardConfigProps) {
  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Board Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="columns" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="columns">Columns</TabsTrigger>
            <TabsTrigger value="swimlanes">Swimlanes</TabsTrigger>
            <TabsTrigger value="limits">Limits</TabsTrigger>
            <TabsTrigger value="display">Display</TabsTrigger>
          </TabsList>

          <TabsContent value="columns" className="mt-4">
            <ColumnManager columns={columns} onChange={onColumnsChange} />
          </TabsContent>

          <TabsContent value="swimlanes" className="mt-4">
            <SwimlanesConfig value={swimlanes} onChange={onSwimlanesChange} />
          </TabsContent>

          <TabsContent value="limits" className="mt-4">
            <WipLimitsConfig
              columns={columns}
              limits={wipLimits}
              onChange={onWipLimitsChange}
            />
          </TabsContent>

          <TabsContent value="display" className="mt-4">
            <CardDisplayConfig
              mode={cardDisplayMode}
              onChange={onCardDisplayModeChange}
              visibleFields={visibleFields}
              onVisibleFieldsChange={onVisibleFieldsChange ?? (() => {})}
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
