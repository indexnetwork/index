import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Frame } from '../components/Frame';
import { QualityCompleteness } from '../components/QualityCompleteness';
import { api, type ArtifactRef, type HarnessDescriptor, type IndexIssue } from '../api/client';

interface HarnessState {
  artifacts: ArtifactRef[];
  issues: IndexIssue[];
  descriptor: HarnessDescriptor | null;
  error: string | null;
}

export function Harness() {
  const { harness } = useParams<{ harness: string }>();
  const [state, setState] = useState<HarnessState>({
    artifacts: [],
    issues: [],
    descriptor: null,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    api
      .artifacts()
      .then((result) => {
        if (mounted) {
          const filtered = result.refs.filter((a) => a.harness === harness);
          filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setState((prev) => ({
            ...prev,
            artifacts: filtered,
            issues: result.issues.filter((issue) =>
              issue.path.startsWith(`${harness}/`),
            ),
            error: null,
          }));
        }
      })
      .catch((error) => {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            artifacts: [],
            issues: [],
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });

    // The description is a courtesy line; a failure here must not take the
    // artifact list down with it, so it is fetched and settled separately.
    api
      .harnesses()
      .then((result) => {
        if (!mounted) return;
        const descriptor =
          (result.harnesses ?? []).find((h) => h.harness === harness) ?? null;
        setState((prev) => ({ ...prev, descriptor }));
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [harness]);

  if (state.error !== null) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">{state.error}</p>
        </Frame>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4 mb-4">
        <Link to="/" className="text-term-blue hover:underline">
          ← overview
        </Link>
        <h1 className="text-xl">{harness}</h1>
      </div>

      {state.descriptor !== null && (
        <p className="text-term-dim -mt-2">
          {state.descriptor.question} {state.descriptor.detail}
        </p>
      )}

      <Frame label="artifacts">
        <ArtifactList artifacts={state.artifacts} />
      </Frame>

      {state.issues.length > 0 && (
        <Frame label="index issues">
          <IndexIssues issues={state.issues} />
        </Frame>
      )}
    </div>
  );
}

function ArtifactList({ artifacts }: { artifacts: ArtifactRef[] }) {
  if (artifacts.length === 0) {
    return <p className="text-term-dim">No artifacts yet.</p>;
  }

  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="flex gap-4">
          <Link
            to={`/a/${artifact.id}`}
            className="text-term-blue hover:underline flex-1"
          >
            {artifact.path}
          </Link>
          <span
            className={
              artifact.kind === 'baseline' ? 'text-term-cyan' : 'text-term-dim'
            }
          >
            {artifact.kind}
          </span>
          {artifact.measurementKind === 'historical-quality-pilot' ? (
            <QualityCompleteness
              completeness={artifact.qualityCompleteness}
              className="text-right"
            />
          ) : (
            <span className="w-16 text-right">
              {(artifact.aggregatePassRate * 100).toFixed(1)}%
            </span>
          )}
          <span className="text-term-dim">{formatDate(artifact.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

function IndexIssues({ issues }: { issues: IndexIssue[] }) {
  return (
    <div className="space-y-1">
      {issues.map((issue, i) => (
        <div key={i} className="text-term-yellow">
          <span className="text-term-dim">{issue.path}: </span>
          {issue.message}
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
