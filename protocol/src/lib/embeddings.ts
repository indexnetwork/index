import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // Use Azure OpenAI if configured
  ...(process.env.AZURE_OPENAI_ENDPOINT && {
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
    defaultQuery: { 'api-version': '2024-02-01' },
    defaultHeaders: {
      'api-key': process.env.AZURE_OPENAI_API_KEY,
    },
  }),
});

/**
 * Generate embeddings using OpenAI's text-embedding-3-large model
 * @param text The text to embed
 * @param dimensions Optional: Reduce dimensions (default: 3072)
 * @returns Array of numbers representing the embedding
 */
export async function generateEmbedding(
  text: string, 
  dimensions: number = 3072
): Promise<number[]> {
  try {
    // Clean the text by removing newlines and extra whitespace
    const cleanText = text.replace(/\n/g, ' ').trim();
    
    if (!cleanText) {
      throw new Error('Text cannot be empty');
    }

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: cleanText,
      dimensions,
      encoding_format: 'float',
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('No embedding data returned from OpenAI');
    }

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
