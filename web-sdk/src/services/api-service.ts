import { Message } from '@/types';
import { FetchIndexResponse, ApiServiceConfig } from './api-service.d';


const RANDOM_ID = 'random-b56998d3'; // TODO: remove this

export class ApiService {
  private baseUrl: string;
  private id: string;
  private indexes: string[];

  constructor(config: ApiServiceConfig) {
    this.baseUrl = config.baseUrl;
    this.id = config.id;
    this.indexes = [this.id];
  }

  async *streamMessages(messages: Message[]): AsyncGenerator<string, void, undefined> {
    const response = await fetch(`${this.baseUrl}/api/chat_stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        id: RANDOM_ID,
        indexes: this.indexes,
      })
    });

    if (!response.ok || response.body === null) {
      throw new Error('Error streaming messages');
    }

    const reader = response.body.getReader();
    let decoder = new TextDecoder('utf-8');

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async fetchIndex(): Promise<FetchIndexResponse> {
    const response = await fetch(`${this.baseUrl}/api/indexes/${this.id}`);

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }
    return response.json();
  }
}
