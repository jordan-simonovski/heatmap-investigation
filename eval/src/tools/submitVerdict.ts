import type Anthropic from "@anthropic-ai/sdk";

export type Verdict = {
  rca: string;
  culprit_service: string;
  discriminating_attributes: { key: string; value: string }[];
};

export const SUBMIT_VERDICT: Anthropic.Tool = {
  name: "submit_verdict",
  description:
    "Submit your final root-cause conclusion and end the investigation. Call this exactly once when you are confident.",
  input_schema: {
    type: "object",
    properties: {
      rca: { type: "string", description: "Concise root-cause explanation." },
      culprit_service: { type: "string", description: "The service at fault." },
      discriminating_attributes: {
        type: "array",
        description: "The attribute key/values that distinguish the failing requests.",
        items: {
          type: "object",
          properties: { key: { type: "string" }, value: { type: "string" } },
          required: ["key", "value"],
        },
      },
    },
    required: ["rca", "culprit_service", "discriminating_attributes"],
  },
};
