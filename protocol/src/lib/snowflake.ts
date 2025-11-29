import snowflake from 'snowflake-sdk';
import { log } from './log';

const SNOWFLAKE_ACCOUNT = process.env.SNOWFLAKE_ACCOUNT || '';
const SNOWFLAKE_USERNAME = process.env.SNOWFLAKE_USERNAME || '';
const SNOWFLAKE_PASSWORD = process.env.SNOWFLAKE_PASSWORD || '';
const SNOWFLAKE_WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE || 'twitter_index';
const SNOWFLAKE_DATABASE = process.env.SNOWFLAKE_DATABASE || 'DATA_COLLECTOR_ICEBERG';
const SNOWFLAKE_SCHEMA = process.env.SNOWFLAKE_SCHEMA || 'PUBLIC';

type SnowflakeConnection = any;

function createConnection(): Promise<SnowflakeConnection> {
  return new Promise((resolve, reject) => {
    const connection = snowflake.createConnection({
      account: SNOWFLAKE_ACCOUNT,
      username: SNOWFLAKE_USERNAME,
      password: SNOWFLAKE_PASSWORD,
      warehouse: SNOWFLAKE_WAREHOUSE,
      database: SNOWFLAKE_DATABASE,
      schema: SNOWFLAKE_SCHEMA,
    });

    connection.connect((err: any, conn: any) => {
      if (err) {
        log.error('Snowflake connection error', { error: err.message });
        reject(err);
        return;
      }
      resolve(conn);
    });
  });
}

function executeQuery<T>(connection: SnowflakeConnection, sqlText: string, binds?: any[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (err: any, stmt: any, rows: any) => {
        if (err) {
          log.error('Snowflake query error', { error: err.message, sqlText });
          reject(err);
          return;
        }
        resolve(rows || []);
      },
    });
  });
}

/**
 * Extract Twitter username from various formats:
 * - https://x.com/username
 * - https://twitter.com/username
 * - @username
 * - username
 */
export function extractTwitterUsername(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();

  // Handle URL formats
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Handle @username format
  if (trimmed.startsWith('@')) {
    return trimmed.substring(1);
  }

  // Handle plain username (alphanumeric and underscores only)
  if (/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export interface TwitterProfile {
  ID: string;
  NAME: string;           // Twitter handle/username
  DISPLAY_NAME?: string;  // Display name
  BIO?: string;           // Biography
  LOCATION?: string;
  FOLLOWING_COUNT?: number;
  FOLLOWERS_COUNT?: number;
  TWEETS_COUNT?: number;
}

export interface TwitterTweet {
  ID: string;
  POSTER_ID: string;
  TEXT: string;
  TIMESTAMP: Date | string;
  LIKES?: number;
  REPOSTS?: number;
  VIEWS?: number;
}

/**
 * Fetch Twitter profile from Snowflake by username
 */
export async function fetchTwitterProfile(username: string): Promise<TwitterProfile | null> {
  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PASSWORD) {
    return null;
  }

  let connection: SnowflakeConnection | null = null;

  try {
    connection = await createConnection();


    // Query using actual schema columns
    const sqlText = `
      SELECT ID, NAME, DISPLAY_NAME, BIO, LOCATION, 
             FOLLOWING_COUNT, FOLLOWERS_COUNT, TWEETS_COUNT
      FROM twitter_profiles
      WHERE name = ?
      LIMIT 1
    `;

    const rows = await executeQuery<TwitterProfile>(connection, sqlText, [username]);

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  } catch (error) {
    log.error('Failed to fetch Twitter profile', { username, error: (error as Error).message });
    return null;
  } finally {
    if (connection) {
      connection.destroy((err: any) => {
        if (err) log.error('Error destroying Snowflake connection', { error: err.message });
      });
    }
  }
}

/**
 * Fetch recent tweets from Snowflake by user ID
 */
export async function fetchTwitterTweets(posterId: string, limit: number = 50): Promise<TwitterTweet[]> {
  if (!SNOWFLAKE_ACCOUNT || !SNOWFLAKE_USERNAME || !SNOWFLAKE_PASSWORD) {
    return [];
  }

  let connection: SnowflakeConnection | null = null;

  try {
    connection = await createConnection();

    // Query using actual schema columns
    const sqlText = `
      SELECT ID, POSTER_ID, TEXT, TIMESTAMP, LIKES, REPOSTS, VIEWS
      FROM TWITTER_TWEETS
      WHERE POSTER_ID = ?
      ORDER BY TIMESTAMP DESC
      LIMIT ?
    `;

    const rows = await executeQuery<TwitterTweet>(connection, sqlText, [posterId, limit]);

    return rows;
  } catch (error) {
    log.error('Failed to fetch Twitter tweets', { posterId, error: (error as Error).message });
    return [];
  } finally {
    if (connection) {
      connection.destroy((err: any) => {
        if (err) log.error('Error destroying Snowflake connection', { error: err.message });
      });
    }
  }
}
