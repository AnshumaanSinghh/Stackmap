import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const summarize = (text: string) => client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: text }] });
