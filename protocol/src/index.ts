import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import 'dotenv/config';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import suggestionRoutes from './routes/suggestions';
import intentRoutes from './routes/intents';
import fileRoutes from './routes/files';
import indexRoutes from './routes/indexes';

const app = express();
const PORT = process.env.PORT || 3001;


// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
//app.use('/api/agents', agentRoutes);
app.use('/api/intents', intentRoutes);

app.use('/api/indexes/:indexId/suggested_intents/', suggestionRoutes);
app.use('/api/indexes/:indexId/files', fileRoutes);
app.use('/api/indexes', indexRoutes);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
}); 