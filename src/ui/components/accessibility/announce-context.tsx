/**
 * Announce Context for screen reader announcements
 * Issue #411: WCAG 2.1 AA accessibility compliance
 */
import * as React from 'react';

type Politeness = 'polite' | 'assertive';
type AnnounceFunction = (message: string, politeness?: Politeness) => void;

const AnnounceContext = React.createContext<AnnounceFunction | undefined>(undefined);

interface Announcement {
  id: number;
  message: string;
  politeness: Politeness;
}

export interface AnnounceProviderProps {
  children: React.ReactNode;
}

export function AnnounceProvider({ children }: AnnounceProviderProps) {
  const [announcements, setAnnouncements] = React.useState<Announcement[]>([]);
  const idRef = React.useRef(0);

  const announce: AnnounceFunction = React.useCallback((message: string, politeness: Politeness = 'polite') => {
    const id = idRef.current++;
    setAnnouncements((prev) => [...prev, { id, message, politeness }]);

    // Clear announcement after it's been read
    setTimeout(() => {
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    }, 1000);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      {/* Screen reader only announcements */}
      <div className="sr-only" aria-live="off">
        {announcements.map((announcement) => (
          <div key={announcement.id} aria-live={announcement.politeness} aria-atomic="true">
            {announcement.message}
          </div>
        ))}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): AnnounceFunction {
  const context = React.useContext(AnnounceContext);
  if (!context) {
    throw new Error('useAnnounce must be used within AnnounceProvider');
  }
  return context;
}
