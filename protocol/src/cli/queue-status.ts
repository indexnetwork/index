#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { userQueueManager } from '../lib/queue/llm-queue';
import { queueProcessor } from '../lib/queue/processor';
import { getRedisClient } from '../lib/redis';

interface JobTypeCounts {
  pending: number;
  active: number;
  completed: number;
}

interface QueueStats {
  totalJobs: number;
  jobTypeCounts: Map<string, JobTypeCounts>;
  parallelProcessing: {
    activeUsers: number;
    totalWorkers: number;
  };
  performanceMetrics: {
    avgDuration: number;
    successRate: number;
    failureRate: number;
  };
}

async function getPendingJobsByType(): Promise<Map<string, number>> {
  const redis = getRedisClient();
  const pendingByType = new Map<string, number>();
  
  // Get all active user queue keys
  const activeUsers = await userQueueManager.getActiveUserQueues();
  
  // For each user, get all pending jobs from their queue
  for (const userId of activeUsers) {
    const queueKey = `user_queue:${userId}`;
    
    // Get all jobs in the sorted set (without removing them)
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
  }
  
  return pendingByType;
}

async function getQueueStats(): Promise<QueueStats> {
  // Get pending jobs by type
  const pendingByType = await getPendingJobsByType();
  
  // Get recent job history
  const recentHistory = await queueProcessor.getJobHistory(100);
  
  // Initialize job type counts
  const jobTypeCounts = new Map<string, JobTypeCounts>();
  
  // Count pending jobs
  for (const [jobType, count] of pendingByType.entries()) {
    if (!jobTypeCounts.has(jobType)) {
      jobTypeCounts.set(jobType, { pending: 0, active: 0, completed: 0 });
    }
    jobTypeCounts.get(jobType)!.pending = count;
  }
  
  // Count active and completed jobs from history
  for (const job of recentHistory) {
    // Map job names back to job types
    let jobType: string;
    if (job.jobName.includes('Index Intent')) {
      jobType = 'index_intent';
    } else if (job.jobName.includes('Generate Intents')) {
      jobType = 'generate_intents';
    } else {
      jobType = job.jobName.toLowerCase().replace(/\s+/g, '_');
    }
    
    if (!jobTypeCounts.has(jobType)) {
      jobTypeCounts.set(jobType, { pending: 0, active: 0, completed: 0 });
    }
    
    if (job.status === 'processing') {
      jobTypeCounts.get(jobType)!.active++;
    } else if (job.status === 'completed') {
      jobTypeCounts.get(jobType)!.completed++;
    }
  }
  
  // Get parallel processing stats
  const parallelStats = userQueueManager.getParallelStats();
  
  // Calculate performance metrics
  const completedJobs = recentHistory.filter(j => j.status === 'completed');
  const failedJobs = recentHistory.filter(j => j.status === 'failed');
  const totalCompleted = completedJobs.length + failedJobs.length;
  
  const avgDuration = completedJobs.length > 0
    ? completedJobs.reduce((sum, j) => sum + (j.duration || 0), 0) / completedJobs.length
    : 0;
  
  const successRate = totalCompleted > 0 ? (completedJobs.length / totalCompleted) * 100 : 0;
  const failureRate = totalCompleted > 0 ? (failedJobs.length / totalCompleted) * 100 : 0;
  
  const totalJobs = Array.from(pendingByType.values()).reduce((sum, count) => sum + count, 0);
  
  return {
    totalJobs,
    jobTypeCounts,
    parallelProcessing: {
      activeUsers: parallelStats.activeUsers,
      totalWorkers: parallelStats.totalWorkers
    },
    performanceMetrics: {
      avgDuration: Math.round(avgDuration),
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100
    }
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour12: false });
}

function clearScreen() {
  console.clear();
}

function getJobTypeName(jobType: string): string {
  switch (jobType) {
    case 'index_intent': return 'Index Intent';
    case 'generate_intents': return 'Generate Intents';
    default: return jobType;
  }
}

async function displayQueueStatus() {
  try {
    const stats = await getQueueStats();
    
    clearScreen();
    
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║        QUEUE STATUS DASHBOARD - LIVE MONITORING           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    console.log(`  🕐 Last Updated: ${formatTimestamp()}                    Press Ctrl+C to exit\n`);
    
    // Queue Overview
    console.log('📊 QUEUE OVERVIEW');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`  Total Pending: ${stats.totalJobs}`);
    console.log(`  Active Users: ${stats.parallelProcessing.activeUsers}`);
    console.log(`  Active Workers: ${stats.parallelProcessing.totalWorkers}`);
    console.log('');
    
    // Job Counts by Type
    if (stats.jobTypeCounts.size > 0) {
      console.log('📋 JOB COUNTS BY TYPE');
      console.log('─────────────────────────────────────────────────────────────');
      console.log('  Job Type                  Pending  Active  Completed');
      console.log('  ───────────────────────────────────────────────────────────');
      
      for (const [jobType, counts] of stats.jobTypeCounts.entries()) {
        const name = getJobTypeName(jobType).padEnd(24);
        const pending = counts.pending.toString().padStart(7);
        const active = counts.active.toString().padStart(7);
        const completed = counts.completed.toString().padStart(10);
        
        console.log(`  ${name}${pending}${active}${completed}`);
      }
      console.log('');
    } else {
      console.log('📋 JOB COUNTS BY TYPE');
      console.log('─────────────────────────────────────────────────────────────');
      console.log('  No jobs in queue');
      console.log('');
    }
    
    // Performance Metrics
    console.log('📈 PERFORMANCE METRICS (Recent 100 Jobs)');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`  Average Duration: ${formatDuration(stats.performanceMetrics.avgDuration)}`);
    console.log(`  Success Rate: ${stats.performanceMetrics.successRate}%`);
    console.log(`  Failure Rate: ${stats.performanceMetrics.failureRate}%`);
    console.log('');
    
    // Configuration Info
    console.log('⚙️  CONFIGURATION');
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`  Max Concurrent Users: ${process.env.QUEUE_MAX_USERS || '10'}`);
    console.log(`  Max Workers Per User: ${process.env.QUEUE_MAX_WORKERS_PER_USER || '3'}`);
    console.log(`  Total Concurrency: ${process.env.QUEUE_CONCURRENCY || '3'}`);
    console.log(`  Poll Interval: ${process.env.QUEUE_POLL_INTERVAL_MS || '100'}ms`);
    console.log(`  Refresh Interval: ${refreshInterval / 1000}s`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Error checking queue status:', error);
  }
}

// Configuration
const refreshInterval = parseInt(process.env.QUEUE_STATUS_REFRESH_MS || '2000');
let monitoringInterval: NodeJS.Timeout | null = null;

async function startMonitoring() {
  console.log('🚀 Starting queue status monitoring...\n');
  
  // Initial display
  await displayQueueStatus();
  
  // Set up periodic refresh
  monitoringInterval = setInterval(async () => {
    await displayQueueStatus();
  }, refreshInterval);
}

// Handle graceful shutdown
function shutdown() {
  console.log('\n\n👋 Shutting down queue monitor...');
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start monitoring
startMonitoring().catch(error => {
  console.error('Failed to start monitoring:', error);
  process.exit(1);
});
