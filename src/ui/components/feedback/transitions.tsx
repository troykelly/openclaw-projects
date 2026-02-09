import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/ui/lib/utils';

// Check for reduced motion preference
function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return reducedMotion;
}

// Fade transition
export interface FadeProps {
  show: boolean;
  duration?: number;
  children: React.ReactNode;
  className?: string;
  unmountOnHide?: boolean;
}

export function Fade({ show, duration = 200, children, className, unmountOnHide = false }: FadeProps) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(show);

  useEffect(() => {
    if (show) {
      setMounted(true);
    } else if (unmountOnHide) {
      const timer = setTimeout(() => setMounted(false), duration);
      return () => clearTimeout(timer);
    }
  }, [show, unmountOnHide, duration]);

  if (!mounted && unmountOnHide) return null;

  return (
    <div
      className={cn('transition-opacity', reducedMotion ? 'duration-0' : `duration-${duration}`, show ? 'opacity-100' : 'opacity-0', className)}
      style={{ transitionDuration: reducedMotion ? '0ms' : `${duration}ms` }}
    >
      {children}
    </div>
  );
}

// Slide transition
export interface SlideProps {
  show: boolean;
  direction?: 'up' | 'down' | 'left' | 'right';
  duration?: number;
  distance?: number;
  children: React.ReactNode;
  className?: string;
}

export function Slide({ show, direction = 'up', duration = 200, distance = 20, children, className }: SlideProps) {
  const reducedMotion = useReducedMotion();

  const transforms = {
    up: `translateY(${show ? 0 : distance}px)`,
    down: `translateY(${show ? 0 : -distance}px)`,
    left: `translateX(${show ? 0 : distance}px)`,
    right: `translateX(${show ? 0 : -distance}px)`,
  };

  return (
    <div
      className={cn('transition-all', className)}
      style={{
        transitionDuration: reducedMotion ? '0ms' : `${duration}ms`,
        opacity: show ? 1 : 0,
        transform: reducedMotion ? 'none' : transforms[direction],
      }}
    >
      {children}
    </div>
  );
}

// Scale transition (for modals/cards)
export interface ScaleProps {
  show: boolean;
  duration?: number;
  origin?: 'center' | 'top' | 'bottom';
  children: React.ReactNode;
  className?: string;
}

export function Scale({ show, duration = 200, origin = 'center', children, className }: ScaleProps) {
  const reducedMotion = useReducedMotion();

  const origins = {
    center: 'center',
    top: 'top',
    bottom: 'bottom',
  };

  return (
    <div
      className={cn('transition-all', className)}
      style={{
        transitionDuration: reducedMotion ? '0ms' : `${duration}ms`,
        opacity: show ? 1 : 0,
        transform: reducedMotion ? 'none' : show ? 'scale(1)' : 'scale(0.95)',
        transformOrigin: origins[origin],
      }}
    >
      {children}
    </div>
  );
}

// Collapse transition (for accordions/sidebars)
export interface CollapseProps {
  show: boolean;
  duration?: number;
  direction?: 'vertical' | 'horizontal';
  children: React.ReactNode;
  className?: string;
}

export function Collapse({ show, duration = 200, direction = 'vertical', children, className }: CollapseProps) {
  const reducedMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (contentRef.current) {
      setSize(direction === 'vertical' ? contentRef.current.scrollHeight : contentRef.current.scrollWidth);
    }
  }, [children, direction]);

  const isVertical = direction === 'vertical';
  const sizeProperty = isVertical ? 'maxHeight' : 'maxWidth';

  return (
    <div
      className={cn('overflow-hidden transition-all', className)}
      style={{
        transitionDuration: reducedMotion ? '0ms' : `${duration}ms`,
        [sizeProperty]: show ? (size ?? 'none') : 0,
        opacity: show ? 1 : 0,
      }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

// Stagger children animation (for lists)
export interface StaggerChildrenProps {
  show: boolean;
  staggerDelay?: number;
  initialDelay?: number;
  children: React.ReactNode[];
  className?: string;
}

export function StaggerChildren({ show, staggerDelay = 50, initialDelay = 0, children, className }: StaggerChildrenProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className={className}>
      {React.Children.map(children, (child, index) => (
        <div
          className="transition-all duration-200"
          style={{
            transitionDelay: reducedMotion ? '0ms' : `${initialDelay + index * staggerDelay}ms`,
            opacity: show ? 1 : 0,
            transform: reducedMotion ? 'none' : show ? 'translateY(0)' : 'translateY(10px)',
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
