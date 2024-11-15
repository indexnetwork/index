import RedisClient from "../clients/redis.js";

const redis = RedisClient.getInstance();

export async function getOpenRank(fid) {
    try {
      // Check cache first
      const cacheKey = `openrank:${fid}`;
      const cachedScore = await redis.get(cacheKey);
      if (cachedScore !== null) {
        return parseFloat(cachedScore);
      }
  
      const response = await fetch('https://graph.cast.k3l.io/scores/global/following/fids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([fid]),
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const data = await response.json();
      
      if (data.result && data.result.length > 0) {
        const score = data.result[0].percentile;
        // Cache score for 7 days
        await redis.set(cacheKey, score, 'EX', 7 * 24 * 60 * 60);
        return score;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error fetching OpenRank:', error);
      return null;
    }
  }
  