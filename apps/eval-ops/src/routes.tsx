import { createBrowserRouter } from 'react-router';
import { Shell } from './components/Shell';
import { Overview } from './routes/Overview';
import { Harness } from './routes/Harness';
import { Run } from './routes/Run';
import { ArtifactView } from './routes/ArtifactView';
import { Launch } from './routes/Launch';
import { Profiles } from './routes/Profiles';
import { Compare } from './routes/Compare';
import { Fixture } from './routes/Fixture';

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      {
        path: '/',
        element: <Overview />,
      },
      {
        path: '/h/:harness',
        element: <Harness />,
      },
      {
        path: '/r/:runId',
        element: <Run />,
      },
      {
        // Artifacts are addressed separately from runs: a committed baseline or a
        // CLI-produced report has no run record to stream.
        path: '/a/:artifactId',
        element: <ArtifactView />,
      },
      {
        path: '/launch',
        element: <Launch />,
      },
      {
        path: '/profiles',
        element: <Profiles />,
      },
      {
        path: '/compare',
        element: <Compare />,
      },
      {
        path: '/fixture',
        element: <Fixture />,
      },
    ],
  },
]);
