import { useParams, Outlet } from 'react-router';

/**
 * Project detail page placeholder with nested route outlet.
 * Actual implementation will be added in Phase 2 issues.
 */
export function ProjectDetailPage(): React.JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <div data-testid="page-project-detail" className="p-6">
      <h1 className="text-2xl font-semibold">Project: {projectId}</h1>
      <Outlet />
    </div>
  );
}
