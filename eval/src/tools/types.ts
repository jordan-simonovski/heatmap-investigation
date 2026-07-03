import type Anthropic from "@anthropic-ai/sdk";

export type Handler = (input: any) => Promise<string>;

export type ArmTools = {
  name: "wide-sql" | "bubble-up" | "pillars";
  definitions: Anthropic.Tool[];
  handlers: Record<string, Handler>;
};
