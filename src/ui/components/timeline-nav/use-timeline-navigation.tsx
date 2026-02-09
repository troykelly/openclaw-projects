/**
 * Hook for timeline navigation state
 * Issue #393: Implement timeline zoom enhancements and navigation
 */
import * as React from 'react';
import { getNextZoomIn, getNextZoomOut, addDays, getStepDays, startOfDay, type ZoomLevel } from './timeline-utils';

export interface TimelineNavigationOptions {
  initialZoom?: ZoomLevel;
  initialDate?: Date;
  onZoomChange?: (zoom: ZoomLevel) => void;
  onDateChange?: (date: Date) => void;
}

export interface TimelineNavigationState {
  zoom: ZoomLevel;
  currentDate: Date;
  setZoom: (zoom: ZoomLevel) => void;
  setCurrentDate: (date: Date) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  jumpToToday: () => void;
  navigatePrevious: () => void;
  navigateNext: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

export function useTimelineNavigation(options: TimelineNavigationOptions = {}): TimelineNavigationState {
  const { initialZoom = 'week', initialDate = new Date(), onZoomChange, onDateChange } = options;

  const [zoom, setZoomState] = React.useState<ZoomLevel>(initialZoom);
  const [currentDate, setCurrentDateState] = React.useState<Date>(startOfDay(initialDate));

  const setZoom = React.useCallback(
    (newZoom: ZoomLevel) => {
      setZoomState(newZoom);
      onZoomChange?.(newZoom);
    },
    [onZoomChange],
  );

  const setCurrentDate = React.useCallback(
    (newDate: Date) => {
      setCurrentDateState(startOfDay(newDate));
      onDateChange?.(newDate);
    },
    [onDateChange],
  );

  const zoomIn = React.useCallback(() => {
    const nextZoom = getNextZoomIn(zoom);
    if (nextZoom) {
      setZoom(nextZoom);
    }
  }, [zoom, setZoom]);

  const zoomOut = React.useCallback(() => {
    const nextZoom = getNextZoomOut(zoom);
    if (nextZoom) {
      setZoom(nextZoom);
    }
  }, [zoom, setZoom]);

  const jumpToToday = React.useCallback(() => {
    setCurrentDate(new Date());
  }, [setCurrentDate]);

  const navigatePrevious = React.useCallback(() => {
    const stepDays = getStepDays(zoom);
    setCurrentDate(addDays(currentDate, -stepDays));
  }, [zoom, currentDate, setCurrentDate]);

  const navigateNext = React.useCallback(() => {
    const stepDays = getStepDays(zoom);
    setCurrentDate(addDays(currentDate, stepDays));
  }, [zoom, currentDate, setCurrentDate]);

  const canZoomIn = getNextZoomIn(zoom) !== null;
  const canZoomOut = getNextZoomOut(zoom) !== null;

  return {
    zoom,
    currentDate,
    setZoom,
    setCurrentDate,
    zoomIn,
    zoomOut,
    jumpToToday,
    navigatePrevious,
    navigateNext,
    canZoomIn,
    canZoomOut,
  };
}
