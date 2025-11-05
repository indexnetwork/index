import { Router } from 'express';
import { authenticatePrivy, AuthRequest } from '../middleware/auth';
import { queueProcessor } from '../lib/queue/processor';
import { getRedisClient } from '../lib/redis';
import { userQueueManager } from '../lib/queue/llm-queue';

const router = Router();

interface JobTypeCounts {
  pending: number;
  active: number;
  completed: number;
}

interface QueueStatusResponse {
  jobCounts: {
    [jobType: string]: JobTypeCounts;
  };
  totalPending: number;
}

async function getPendingJobsByType(userId: string): Promise<Map<string, number>> {
  const redis = getRedisClient();
  const pendingByType = new Map<string, number>();
  const queueKey = `user_queue:${userId}`;
  
  // Get all jobs in the user's sorted set
  const jobs = await redis.zrange(queueKey, 0, -1);
  
  for (const jobStr of jobs) {
    try {
      const job = JSON.parse(jobStr);
      const jobType = job.action || 'unknown';
      pendingByType.set(jobType, (pendingByType.get(jobType) || 0) + 1);
    } catch (error) {
      // Skip malformed jobs
    }
  }
  
  return pendingByType;
}

async function getJobCountsForUser(userId: string): Promise<QueueStatusResponse> {
  // Get pending jobs by type for this user
  const pendingByType = await getPendingJobsByType(userId);
  
  // Get recent job history
  const recentHistory = await queueProcessor.getJobHistory(100);
  
  // Filter history for this user's jobs
  const userHistory = recentHistory.filter(job => {
    const jobData = job.jobData as any;
    return jobData.userId === userId;
  });
  
  // Initialize job type counts
  const jobTypeCounts: { [jobType: string]: JobTypeCounts } = {};
  
  // Count pending jobs
  for (const [jobType, count] of pendingByType.entries()) {
    if (!jobTypeCounts[jobType]) {
      jobTypeCounts[jobType] = { pending: 0, active: 0, completed: 0 };
    }
    jobTypeCounts[jobType].pending = count;
  }
  
  // Count active and completed jobs from history
  for (const job of userHistory) {
    // Map job names back to job types
    let jobType: string;
    if (job.jobName.includes('Index Intent')) {
      jobType = 'index_intent';
    } else if (job.jobName.includes('Generate Intents')) {
      jobType = 'generate_intents';
    } else {
      jobType = job.jobName.toLowerCase().replace(/\s+/g, '_');
    }
    
    if (!jobTypeCounts[jobType]) {
      jobTypeCounts[jobType] = { pending: 0, active: 0, completed: 0 };
    }
    
    if (job.status === 'processing') {
      jobTypeCounts[jobType].active++;
    } else if (job.status === 'completed') {
      jobTypeCounts[jobType].completed++;
    }
  }
  
  const totalPending = Array.from(pendingByType.values()).reduce((sum, count) => sum + count, 0);
  
  return {
    jobCounts: jobTypeCounts,
    totalPending
  };
}

// GET /api/queue/status - Get queue status for authenticated user
router.get('/status', authenticatePrivy, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const status = await getJobCountsForUser(userId);
    
    res.json(status);
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

export default router;

