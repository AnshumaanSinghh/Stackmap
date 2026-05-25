/**
 * AI Runtime - Claude API integration
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ReviewOptions {
  architecture: string;
  focusAreas?: string[];
}

export interface GenerateOptions {
  description: string;
  systemType?: string;
}

export class AIRuntime {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.CLAUDE_API_KEY,
    });
  }

  async reviewArchitecture(options: ReviewOptions): Promise<string> {
    const prompt = `
You are an expert system architect. Review the following architecture for:
${options.focusAreas?.map((area) => `- ${area}`).join("\n") || "- scalability\n- reliability\n- single points of failure\n- database bottlenecks\n- caching opportunities"}

Architecture:
${options.architecture}

Provide a detailed review with specific recommendations.
    `;

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return message.content[0].type === "text" ? message.content[0].text : "";
  }

  async generateArchitecture(options: GenerateOptions): Promise<string> {
    const prompt = `
You are an expert system architect. Generate a system architecture diagram (in ASCII or structured text format) for the following:

${options.description}

System Type: ${options.systemType || "General"}

Provide:
1. Architecture overview
2. Key components
3. Data flow
4. Integration points
5. Deployment strategy
    `;

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return message.content[0].type === "text" ? message.content[0].text : "";
  }

  async cleanupArchitecture(architecture: string): Promise<string> {
    const prompt = `
You are an expert system architect. Analyze the following architecture and suggest improvements for:
- Organization and clarity
- Component naming
- Logical grouping
- Redundancy elimination

Current Architecture:
${architecture}

Provide a cleaned-up version with explanations of changes.
    `;

    const message = await this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return message.content[0].type === "text" ? message.content[0].text : "";
  }
}

export default AIRuntime;
