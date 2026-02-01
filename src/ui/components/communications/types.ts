export interface LinkedEmail {
  id: string;
  subject: string;
  from: {
    name: string;
    email: string;
  };
  to: {
    name: string;
    email: string;
  }[];
  date: Date;
  snippet: string;
  body?: string;
  hasAttachments?: boolean;
  isRead?: boolean;
}

export interface CalendarAttendee {
  name: string;
  email: string;
  status: 'accepted' | 'declined' | 'tentative' | 'pending';
}

export interface LinkedCalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  isAllDay?: boolean;
  location?: string;
  attendees: CalendarAttendee[];
  organizer?: {
    name: string;
    email: string;
  };
  meetingLink?: string;
}

export interface CommunicationFilter {
  type?: 'email' | 'calendar';
  search?: string;
}
