import { createBrowserRouter } from 'react-router';
import { Shell } from './components/Shell';
import { Overview } from './routes/Overview';
import { Harness } from './routes/Harness';
import { Run } from './routes/Run';
import { Launch } from './routes/Launch';
import { Profiles } from './routes/Profiles';
import { Compare } from './routes/Compare';

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
    ],
  },
]);
