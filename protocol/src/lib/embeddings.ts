import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://index.network',
    'X-Title': 'Index Network',
  },
});

export async function generateEmbedding(
  text: string, 
  dimensions: number = 2000
): Promise<number[]> {
  try {
    // Clean the text by removing newlines and extra whitespace
    const cleanText = text.replace(/\n/g, ' ').trim();
    
    if (!cleanText) {
      throw new Error('Text cannot be empty');
    }

    console.log('Generating embedding using OpenAI for:', cleanText);

    const response = await openai.embeddings.create({
      model: 'openai/text-embedding-3-large',
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
