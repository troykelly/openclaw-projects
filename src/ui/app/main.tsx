import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

type WorkItemSummary = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  task_type: string | null;
  created_at: string;
  updated_at: string;
};

type WorkItemsResponse = {
  items: WorkItemSummary[];
};

function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return path;
}

function WorkItemsListPage(): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; items: WorkItemSummary[] }
  >({ kind: 'loading' });

  useEffect(() => {
    let alive = true;

    async function run(): Promise<void> {
      try {
        const res = await fetch('/api/work-items', {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`GET /api/work-items failed: ${res.status}`);

        const data = (await res.json()) as WorkItemsResponse;
        if (!alive) return;
        setState({ kind: 'loaded', items: data.items });
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ kind: 'error', message });
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main style={{ padding: 16 }}>
      <h1>Work items</h1>

      {state.kind === 'loading' ? <p>Loading…</p> : null}
      {state.kind === 'error' ? <p style={{ color: 'crimson' }}>Error: {state.message}</p> : null}

      {state.kind === 'loaded' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Title</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '6px 4px' }}>Priority</th>
            </tr>
          </thead>
          <tbody>
            {state.items.map((i) => (
              <tr key={i.id}>
                <td style={{ padding: '6px 4px' }}>
                  <a href={`/app/work-items/${encodeURIComponent(i.id)}`}>{i.title}</a>
                </td>
                <td style={{ padding: '6px 4px' }}>{i.status ?? '—'}</td>
                <td style={{ padding: '6px 4px' }}>{i.priority ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}

function WorkItemDetailPage(props: { id: string }): React.JSX.Element {
  return (
    <main style={{ padding: 16 }}>
      <p>
        <a href="/app/work-items">← Back</a>
      </p>
      <h1>Work item {props.id}</h1>
      <p>(detail page TBD)</p>
    </main>
  );
}

function NotFoundPage(props: { path: string }): React.JSX.Element {
  return (
    <main style={{ padding: 16 }}>
      <h1>Not found</h1>
      <p>{props.path}</p>
      <p>
        <a href="/app/work-items">Go to work items</a>
      </p>
    </main>
  );
}

function App(): React.JSX.Element {
  const path = usePathname();

  const route = useMemo(() => {
    const list = /^\/app\/work-items\/?$/;
    const detail = /^\/app\/work-items\/([^/]+)\/?$/;

    if (list.test(path)) return { kind: 'list' as const };

    const d = path.match(detail);
    if (d) return { kind: 'detail' as const, id: d[1] };

    return { kind: 'not-found' as const, path };
  }, [path]);

  if (route.kind === 'list') return <WorkItemsListPage />;
  if (route.kind === 'detail') return <WorkItemDetailPage id={route.id} />;
  return <NotFoundPage path={route.path} />;
}

const el = document.getElementById('root');
if (!el) throw new Error('Missing #root element');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
