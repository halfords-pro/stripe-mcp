#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// Server metadata
const SERVER_NAME = "stripe-mcp-server";
const SERVER_VERSION = "1.0.0";

// Create the MCP server instance
const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Define available tools
const TOOLS = [
  {
    name: "example_tool",
    description: "An example tool that echoes back the input. Replace this with your actual tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "The message to echo back",
        },
      },
      required: ["message"],
    },
  },
];

// Define available resources
const RESOURCES = [
  {
    uri: "example://info",
    name: "Example Resource",
    description: "An example resource. Replace this with your actual resources.",
    mimeType: "text/plain",
  },
];

// Handler for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Handler for executing tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "example_tool": {
      const message = args?.message as string;
      if (!message) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing required parameter: message"
        );
      }
      return {
        content: [
          {
            type: "text",
            text: `Echo: ${message}`,
          },
        ],
      };
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
});

// Handler for listing available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: RESOURCES,
  };
});

// Handler for reading resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case "example://info":
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: "This is an example resource. Replace this with your actual resource content.",
          },
        ],
      };

    default:
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
  }
});

// Main entry point
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio communication
  console.error(`${SERVER_NAME} v${SERVER_VERSION} started`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
