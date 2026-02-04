import { useParams } from 'react-router';

/**
 * Contact detail page placeholder.
 * Actual implementation will be added in Phase 2 issues.
 */
export function ContactDetailPage(): React.JSX.Element {
  const { contactId } = useParams<{ contactId: string }>();
  return (
    <div data-testid="page-contact-detail" className="p-6">
      <h1 className="text-2xl font-semibold">Contact: {contactId}</h1>
    </div>
  );
}
