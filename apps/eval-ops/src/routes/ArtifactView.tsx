import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Frame } from '../components/Frame';
import { CaseTable } from '../components/CaseTable';
import { api, type Artifact } from '../api/client';

/**
 * Detail view for a stored artifact: a committed baseline, a CLI-produced run
 * report, or the report of a run launched here.
 *
 * This is deliberately distinct from `/r/:runId`. A run record is a *process* —
 * it has a live log, an exit code, and a cancel button. An artifact is the
 * *result* that outlives it: most artifacts the index finds (every committed
 * baseline, every report produced by the CLI) have no run record at all, because
 * no run of this app ever produced them. Pointing those at the run view is what
 * made every baseline link dead-end.
 */
export function ArtifactView() {
  const { artifactId } = useParams<{ artifactId: string }>();

  if (!artifactId) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">Artifact ID is required</p>
        </Frame>
      </div>
    );
  }

  return <ArtifactDetail artifactId={artifactId} />;
}

interface ArtifactState {
  artifact: Artifact | null;
  error: string | null;
}

function ArtifactDetail({ artifactId }: { artifactId: string }) {
  const [state, setState] = useState<ArtifactState>({ artifact: null, error: null });

  useEffect(() => {
    let mounted = true;

    api
      .artifact(artifactId)
      .then((artifact) => {
        if (mounted) setState({ artifact, error: null });
      })
      .catch((error: unknown) => {
        if (mounted) {
          setState({
            artifact: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, [artifactId]);

  if (state.error !== null) {
    return (
      <div className="p-4 space-y-4">
        <Link to="/" className="text-term-blue hover:underline">
          ← overview
        </Link>
        <Frame label="error">
          <p className="text-term-red">{state.error}</p>
        </Frame>
      </div>
    );
  }

  if (state.artifact === null) {
    return (
      <div className="p-4">
        <p className="text-term-dim">Loading...</p>
      </div>
    );
  }

  const artifact = state.artifact;
  const isBaseline = artifact.artifactType.endsWith('/baseline');
  const filters = Object.entries(artifact.selection?.filters ?? {});

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-term-blue hover:underline">
          ← overview
        </Link>
        <Link to={`/h/${artifact.harness}`} className="text-term-blue hover:underline">
          {artifact.harness}
        </Link>
      </div>

      <Frame label={isBaseline ? 'baseline' : 'run report'}>
        <div className="space-y-2">
          <Row label="harness">
            <Link to={`/h/${artifact.harness}`} className="text-term-blue hover:underline">
              {artifact.harness}
            </Link>
            <span className="text-term-dim ml-2">v{artifact.harnessVersion}</span>
          </Row>
          <Row label="kind">
            <span className={isBaseline ? 'text-term-cyan' : 'text-term-dim'}>
              {isBaseline ? 'baseline' : 'run'}
            </span>
          </Row>
          <Row label="created">{formatDate(artifact.createdAt)}</Row>
          <Row label="models">
            <span className="font-mono text-sm">{artifact.models.join(', ')}</span>
          </Row>
          <Row label="runs">{artifact.runs}</Row>
          <Row label="selection">
            {artifact.selection?.fullCorpus ? (
              'full corpus'
            ) : filters.length > 0 ? (
              <span className="font-mono text-sm">
                {filters.map(([key, value]) => `${key}=${value}`).join(' ')}
              </span>
            ) : (
              'partial'
            )}
          </Row>
          <Row label="git">
            <span className="font-mono text-sm">{artifact.git?.revision ?? 'unknown'}</span>
            {artifact.git?.dirty === true && (
              <span className="text-term-yellow ml-2">(dirty)</span>
            )}
          </Row>
          <Row label="corpus">
            <span className="font-mono text-sm text-term-dim">
              {artifact.corpusFingerprint}
            </span>
          </Row>
          <Row label="config">
            <span className="font-mono text-sm text-term-dim">
              {artifact.configFingerprint}
            </span>
          </Row>
          <Row label="schema">v{artifact.schemaVersion}</Row>
        </div>
      </Frame>

      <Frame label="scorecard">
        <div className="space-y-2">
          <Row label="aggregate pass rate">
            {(artifact.payload.aggregatePassRate * 100).toFixed(1)}%
          </Row>
          <CaseTable cases={artifact.payload.cases} />
        </div>
      </Frame>

      <Frame label="compare">
        <p className="text-term-dim">
          To diff this against another artifact of the same harness, use{' '}
          <Link
            to={`/compare?subject=${encodeURIComponent(artifactId)}`}
            className="text-term-blue hover:underline"
          >
            compare
          </Link>
          .
        </p>
      </Frame>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="text-term-dim w-40 shrink-0">{label}:</span>
      <span>{children}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
