import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type DraftDetails = { to: string; subject: string; body: string };

type DraftTool = {
  name: string;
  title?: string;
  inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
};

function matchingField(properties: Record<string, { type?: string }>, names: string[]): string | null {
  const key = Object.keys(properties).find((item) => names.includes(item.toLowerCase()));
  return key ?? null;
}

export function prepareDraftToolCall(tools: DraftTool[], draft: DraftDetails) {
  const choices = tools.filter((tool) => {
    const label = `${tool.name} ${tool.title ?? ""}`.toLowerCase();
    return label.includes("gmail") && /create[\s_-]*draft/.test(label);
  });
  if (choices.length !== 1) throw new Error("Configure exactly one Gmail Create Draft action on a managed Zapier MCP server.");

  const tool = choices[0];
  const properties = tool.inputSchema.properties ?? {};
  const toKey = matchingField(properties, ["to", "to_email", "email_to", "recipient", "recipients"]);
  const subjectKey = matchingField(properties, ["subject", "email_subject"]);
  const bodyKey = matchingField(properties, ["body", "body_plain", "email_body", "message", "message_body"]);
  if (!toKey || !subjectKey || !bodyKey) throw new Error("The Gmail Create Draft action needs editable recipient, subject and body fields in Zapier.");

  const mapped = new Set([toKey, subjectKey, bodyKey]);
  const unsupported = (tool.inputSchema.required ?? []).filter((key) => !mapped.has(key));
  if (unsupported.length) throw new Error("The Gmail Create Draft action has additional required fields. Configure their values in Zapier before use.");

  return {
    name: tool.name,
    arguments: {
      [toKey]: properties[toKey].type === "array" ? [draft.to] : draft.to,
      [subjectKey]: draft.subject,
      [bodyKey]: draft.body,
    },
  };
}

export async function createGmailDraft(draft: DraftDetails, token: string): Promise<{ draftId: string | null }> {
  const client = new Client({ name: "kitchen-planner", version: "0.1.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.zapier.com/api/v1/connect"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools(undefined, { timeout: 15_000 });
    const call = prepareDraftToolCall(listed.tools, draft);
    const result = await client.callTool(call, undefined, { timeout: 45_000 });
    if (result.isError) throw new Error("Zapier could not create the Gmail draft.");
    const structured = result.structuredContent;
    const draftId = structured && typeof structured === "object" && "id" in structured && typeof structured.id === "string" ? structured.id : null;
    return { draftId };
  } finally {
    await client.close().catch(() => undefined);
  }
}
