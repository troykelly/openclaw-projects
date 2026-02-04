import { useParams } from 'react-router';

/**
 * Work item detail page placeholder.
 * Actual implementation will be added in Phase 2 issues.
 */
export function WorkItemDetailPage(): React.JSX.Element {
  const { projectId, itemId } = useParams<{ projectId: string; itemId: string }>();
  return (
    <div data-testid="page-work-item-detail" className="p-6">
      <h1 className="text-2xl font-semibold">
        Work Item: {itemId} (Project: {projectId})
      </h1>
    </div>
  );
}
