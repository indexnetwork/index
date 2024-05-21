import { Message } from "@/types";
import { FetchIndexResponse, ApiServiceConfig } from "./api-service.d";
import { DIDSession } from "did-session";

export class ApiService {
  private baseUrl: string;
  private session: DIDSession | undefined;

  constructor(config: ApiServiceConfig) {
    this.baseUrl = config.baseUrl;
    this.session = config.session;
  }

  async *streamMessages(
    messages: Message[],
    sources: string[],
    chatID: string,
  ): AsyncGenerator<string, void, undefined> {
    const response = await fetch(`${this.baseUrl}/api/chat_stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        id: chatID,
        sources,
      }),
    });

    if (!response.ok || response.body === null) {
      throw new Error("Error streaming messages");
    }

    const reader = response.body.getReader();
    let decoder = new TextDecoder("utf-8");

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

  async getDefaultQuestionsOfIndex(sources: string[]): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/discovery/questions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sources }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }

    const resp = await response.json();
    return resp.questions;
  }

  async fetchIndex(id: string): Promise<FetchIndexResponse> {
    const response = await fetch(`${this.baseUrl}/api/indexes/${id}`);

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }
    return response.json();
  }

  async fetchAllIndexes(did: string): Promise<FetchIndexResponse[]> {
    const response = await fetch(`${this.baseUrl}/api/dids/${did}/indexes`);

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }

    return response.json();
  }

  async fetchProfile(did: string): Promise<any> {
    let headers;
    if (this.session) {
      headers = {
        Authorization: `Bearer ${this.session.serialize()}`,
      };
    }
    const response = await fetch(`${this.baseUrl}/api/dids/${did}/profile`, {
      headers,
    });

    if (!response.ok) {
      const err = await response.json();
      throw err;
    }
    return response.json();
  }
}
