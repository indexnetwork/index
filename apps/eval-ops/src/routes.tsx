import { createBrowserRouter } from 'react-router';
import { Overview } from './routes/Overview';
import { Harness } from './routes/Harness';
import { Run } from './routes/Run';

export const router = createBrowserRouter([
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
]);
