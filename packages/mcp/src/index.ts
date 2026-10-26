import { type Tool, type ToolResult } from "@min-agent/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { z } from "zod";

export type McpServerConfig =
  | {
      name: string;
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      name: string;
      transport: "sse";
      url: string;
    };

export interface McpExtensionOptions {
  servers: McpServerConfig[];
  /** Prefix tool names as `{server}__{tool}` to avoid collisions. Default true. */
  prefixTools?: boolean;
  clientName?: string;
  clientVersion?: string;
}

interface ConnectedServer {
  name: string;
  client: Client;
  close: () => Promise<void>;
}

export interface McpConnection {
  name: "mcp";
  /** Open the configured servers and return their tools. */
  connect(): Promise<{ tools: Tool[]; dispose(): Promise<void> }>;
}

/**
 * Connect to one or more MCP servers and expose their tools.
 * Call `connect()` before `createAgent`, and `dispose()` when the host shuts down.
 */
export function mcp(options: McpExtensionOptions): McpConnection {
  const prefix = options.prefixTools !== false;

  return {
    name: "mcp",

    async connect() {
      const connections: ConnectedServer[] = [];
      const tools: Tool[] = [];
      for (const server of options.servers) {
        const conn = await connectServer(server, {
          name: options.clientName ?? "min",
          version: options.clientVersion ?? "0.1.0",
        });
        connections.push(conn);

        const listed = await conn.client.listTools();
        for (const mcpTool of listed.tools) {
          const toolName = prefix
            ? `${server.name}__${mcpTool.name}`
            : mcpTool.name;

          tools.push(
            mcpToolToMinTool({
              name: toolName,
              remoteName: mcpTool.name,
              description: mcpTool.description ?? `MCP tool ${mcpTool.name}`,
              inputSchema: mcpTool.inputSchema,
              client: conn.client,
            }),
          );
        }
      }

      return {
        tools,
        async dispose() {
          await Promise.all(connections.map((c) => c.close()));
          connections.length = 0;
        },
      };
    },
  };
}

async function connectServer(
  server: McpServerConfig,
  clientInfo: { name: string; version: string },
): Promise<ConnectedServer> {
  const client = new Client(clientInfo, { capabilities: {} });

  if (server.transport === "stdio") {
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: server.env,
    });
    await client.connect(transport);
    return {
      name: server.name,
      client,
      close: async () => {
        await client.close();
      },
    };
  }

  const transport = new SSEClientTransport(new URL(server.url));
  await client.connect(transport);
  return {
    name: server.name,
    client,
    close: async () => {
      await client.close();
    },
  };
}

function mcpToolToMinTool(args: {
  name: string;
  remoteName: string;
  description: string;
  inputSchema: unknown;
  client: Client;
}): Tool<Record<string, unknown>> {
  // MCP tools use JSON Schema; accept any object and let the server validate.
  const inputSchema = z.record(z.unknown());

  return {
    name: args.name,
    description: args.description,
    inputSchema,
    async execute(input, ctx): Promise<ToolResult> {
      try {
        const result = await args.client.callTool(
          {
            name: args.remoteName,
            arguments: input,
          },
          undefined,
          { signal: ctx.signal },
        );

        const text = stringifyMcpContent(result.content);
        const isError = Boolean(result.isError);
        return { content: text || "(empty)", isError };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: message, isError: true };
      }
    },
  };
}

function stringifyMcpContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : JSON.stringify(content);
  }

  return content
    .map((part) => {
      if (part && typeof part === "object" && "type" in part) {
        const p = part as { type: string; text?: string; data?: unknown };
        if (p.type === "text" && typeof p.text === "string") return p.text;
        return JSON.stringify(part);
      }
      return String(part);
    })
    .join("\n");
}

export type { McpExtensionOptions as McpOptions };
