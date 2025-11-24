import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

console.log('process.env', process.env);
import { initializeBrokers } from './agents/context_brokers/connector';
import { queueProcessor } from './lib/queue/processor';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import intentRoutes from './routes/intents';
import fileRoutes from './routes/files';
import indexRoutes from './routes/indexes';
import uploadRoutes from './routes/upload';
import connectionRoutes from './routes/connections';
import synthesisRoutes from './routes/synthesis';
import integrationRoutes from './routes/integrations';
import discoverRoutes from './routes/discover';
import linksRoutes from './routes/links';
import syncRoutes from './routes/sync';
import queueRoutes from './routes/queue';
import adminRoutes from './routes/admin';
import feedbackRoutes from './routes/feedback';

const app = express();
const PORT = process.env.PORT || 3001;


// Middleware
app.use(helmet());
app.use(cors());
// app.use(morgan('combined')); // Temporarily disabled
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
//app.use('/api/agents', agentRoutes);
app.use('/api/intents', intentRoutes);
app.use('/api/connections', connectionRoutes);

// New library-scoped endpoints
app.use('/api/files', fileRoutes);
app.use('/api/links', linksRoutes);
app.use('/api/indexes', indexRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/sync', syncRoutes);

app.use('/api/synthesis', synthesisRoutes);
app.use('/api/discover', discoverRoutes);
app.use('/api/queue', queueRoutes);

app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);

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

(async () => {
  try {
    await initializeBrokers();
    console.log('🟢 Context brokers initialized');
    
    queueProcessor.start();
    console.log('🟢 Queue processor started');
  } catch (err) {
    console.error('🔴 Failed to initialize services:', err);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
  });
})(); 
