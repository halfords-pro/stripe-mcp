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
import Stripe from "stripe";

// Server metadata
const SERVER_NAME = "stripe-mcp-server";
const SERVER_VERSION = "1.0.0";

// Initialize Stripe client
const stripeApiKey = process.env.STRIPE_API_KEY;
if (!stripeApiKey) {
  throw new Error("STRIPE_API_KEY environment variable is required");
}

const stripe = new Stripe(stripeApiKey, {
  apiVersion: "2025-11-17.clover",
  typescript: true,
});

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
    name: "search_invoices",
    description:
      "Search for Stripe invoices by metadata using key:value pairs. Returns a list of matching invoices with summary information. Uses Stripe's Search API to find invoices with specific metadata values.",
    inputSchema: {
      type: "object" as const,
      properties: {
        metadata: {
          type: "string",
          description:
            "Search for invoices by metadata in the format 'key:value' (e.g., 'order_id:12345' or 'customer_type:premium'). Required.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of invoices to return (default: 10, max: 100)",
          minimum: 1,
          maximum: 100,
        },
        page: {
          type: "string",
          description:
            "Pagination cursor for next page of results. Use the 'next_page' value from a previous search response.",
        },
      },
      required: ["metadata"],
    },
  },
  {
    name: "create_credit_note",
    description:
      "Create a credit note for a Stripe invoice. Automatically fetches the invoice and credits the full invoice amount with an optional memo and reason. Returns detailed credit note information including ID, amounts, status, and PDF link.",
    inputSchema: {
      type: "object" as const,
      properties: {
        invoice_id: {
          type: "string",
          description:
            "The Stripe invoice ID to credit (e.g., 'in_1MtHbELkdIwHu7ix...'). Required.",
          pattern: "^in_[a-zA-Z0-9]+$",
        },
        memo: {
          type: "string",
          description:
            "Reason for the credit note. This appears on the credit note PDF sent to the customer.",
        },
        reason: {
          type: "string",
          description:
            "The reason for the credit note. Must be one of: 'duplicate', 'fraudulent', 'order_change', or 'product_unsatisfactory'.",
          enum: [
            "duplicate",
            "fraudulent",
            "order_change",
            "product_unsatisfactory",
          ],
        },
      },
      required: ["invoice_id"],
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

// Formatting helper functions

/**
 * Builds a Stripe search query for metadata key:value pair
 */
function buildMetadataSearchQuery(metadataString: string): string {
  const parts = metadataString.split(":");
  if (parts.length < 2) {
    throw new Error(
      "Invalid metadata format. Expected 'key:value' (e.g., 'order_id:12345')"
    );
  }

  const key = parts[0].trim();
  const value = parts.slice(1).join(":").trim(); // Handle values with colons

  if (!key || !value) {
    throw new Error("Metadata key and value cannot be empty");
  }

  // Escape quotes in value if present
  const escapedValue = value.replace(/"/g, '\\"');

  // Build Stripe search query: metadata['key']:'value'
  return `metadata['${key}']:'${escapedValue}'`;
}

/**
 * Formats a Stripe amount (in cents) to a readable currency string
 */
function formatAmount(amountInCents: number | null, currency: string): string {
  if (amountInCents === null) return "N/A";
  const amount = amountInCents / 100;
  return `${amount.toFixed(2)} ${currency}`;
}

/**
 * Formats a Unix timestamp to a readable date string
 */
function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return "N/A";
  return new Date(timestamp * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Formats multiple invoices as a summary list
 */
function formatInvoicesList(
  invoices: Stripe.Invoice[],
  metadataFilter?: string
): string {
  const sections: string[] = [];

  sections.push(
    `FOUND ${invoices.length} INVOICE${invoices.length !== 1 ? "S" : ""}`
  );
  if (metadataFilter) {
    sections.push(`Filtered by metadata: ${metadataFilter}`);
  }
  sections.push("");

  if (invoices.length === 0) {
    sections.push("No invoices found matching the criteria.");
    return sections.join("\n");
  }

  invoices.forEach((invoice, index) => {
    const currency = invoice.currency.toUpperCase();
    sections.push(`${index + 1}. Invoice ${invoice.id}`);
    sections.push(`   Status: ${invoice.status?.toUpperCase() || "N/A"}`);
    sections.push(
      `   Customer: ${invoice.customer_name || invoice.customer_email || "N/A"}`
    );
    sections.push(`   Total: ${formatAmount(invoice.total, currency)}`);
    sections.push(`   Amount Due: ${formatAmount(invoice.amount_due, currency)}`);
    sections.push(`   Created: ${formatTimestamp(invoice.created)}`);

    // Show metadata if present
    if (invoice.metadata && Object.keys(invoice.metadata).length > 0) {
      const metadataEntries = Object.entries(invoice.metadata)
        .map(([k, v]) => `${k}:${v}`)
        .join(", ");
      sections.push(`   Metadata: ${metadataEntries}`);
    }

    if (invoice.hosted_invoice_url) {
      sections.push(`   View: ${invoice.hosted_invoice_url}`);
    }
    sections.push("");
  });

  sections.push(
    "Use the invoice ID with find_invoice to get full details for a specific invoice."
  );

  return sections.join("\n");
}

/**
 * Formats a Stripe credit note into a human-readable text summary
 */
function formatCreditNoteResponse(creditNote: Stripe.CreditNote): string {
  const sections: string[] = [];

  // Header
  sections.push(`CREDIT NOTE CREATED: ${creditNote.id}`);
  sections.push(`Status: ${creditNote.status?.toUpperCase() || "N/A"}`);
  sections.push("");

  // Financial Summary
  sections.push("FINANCIAL DETAILS:");
  const currency = creditNote.currency.toUpperCase();
  sections.push(`  Total Amount: ${formatAmount(creditNote.amount, currency)}`);
  sections.push(`  Subtotal: ${formatAmount(creditNote.subtotal, currency)}`);

  if (creditNote.discount_amounts && creditNote.discount_amounts.length > 0) {
    const totalDiscount = creditNote.discount_amounts.reduce(
      (sum: number, d) => sum + d.amount,
      0
    );
    sections.push(`  Discounts: -${formatAmount(totalDiscount, currency)}`);
  }

  sections.push(`  Total: ${formatAmount(creditNote.total, currency)}`);
  sections.push("");

  // Invoice & Customer Info
  sections.push("RELATED INFORMATION:");
  sections.push(`  Invoice: ${creditNote.invoice}`);
  sections.push(`  Customer: ${creditNote.customer}`);
  if (creditNote.customer_balance_transaction) {
    sections.push(
      `  Balance Transaction: ${creditNote.customer_balance_transaction}`
    );
  }
  sections.push("");

  // Reason & Memo
  if (creditNote.reason) {
    sections.push(`REASON: ${creditNote.reason}`);
  }
  if (creditNote.memo) {
    sections.push(`MEMO: ${creditNote.memo}`);
  }
  if (creditNote.reason || creditNote.memo) {
    sections.push("");
  }

  // Timing Information
  sections.push("TIMELINE:");
  sections.push(`  Created: ${formatTimestamp(creditNote.created)}`);
  if (creditNote.effective_at) {
    sections.push(
      `  Effective At: ${formatTimestamp(creditNote.effective_at)}`
    );
  }
  sections.push("");

  // Line Items
  if (creditNote.lines && creditNote.lines.data.length > 0) {
    sections.push(`LINE ITEMS (${creditNote.lines.data.length} items):`);
    creditNote.lines.data.forEach((line, index) => {
      sections.push(`  ${index + 1}. ${line.description || "No description"}`);
      sections.push(`     Amount: ${formatAmount(line.amount, currency)}`);
      if (line.quantity) {
        sections.push(`     Quantity: ${line.quantity}`);
      }
      if (line.unit_amount) {
        sections.push(
          `     Unit Amount: ${formatAmount(line.unit_amount, currency)}`
        );
      }
    });
    sections.push("");
  }

  // PDF Link
  if (creditNote.pdf) {
    sections.push(`Download PDF: ${creditNote.pdf}`);
  }

  return sections.join("\n");
}

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
    case "search_invoices": {
      const metadataString = args?.metadata as string;
      const limit = (args?.limit as number | undefined) || 10;
      const page = args?.page as string | undefined;

      // Validate metadata parameter
      if (!metadataString) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing required parameter: metadata"
        );
      }

      try {
        // Build search query
        const searchQuery = buildMetadataSearchQuery(metadataString);

        // Build search parameters
        const searchParams: Stripe.InvoiceSearchParams = {
          query: searchQuery,
          limit: Math.min(limit, 100),
          expand: ["data.customer"], // Expand customer for name/email
        };

        // Add pagination cursor if provided
        if (page) {
          searchParams.page = page;
        }

        // Execute search using Stripe Search API
        const searchResult = await stripe.invoices.search(searchParams);

        // Format results as list
        let formattedText = formatInvoicesList(
          searchResult.data,
          metadataString
        );

        // Add pagination info if more results available
        if (searchResult.has_more) {
          formattedText += `\n\nMore results available. Use page: "${searchResult.next_page}" to get the next page.`;
        }

        return {
          content: [{ type: "text", text: formattedText }],
        };
      } catch (error) {
        // Re-throw McpErrors as-is
        if (error instanceof McpError) {
          throw error;
        }

        // Handle Stripe-specific errors
        if (error instanceof Stripe.errors.StripeError) {
          if (error.type === "StripeInvalidRequestError") {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Invalid search query: ${error.message}`
            );
          }
          throw new McpError(
            ErrorCode.InternalError,
            `Stripe API error: ${error.message}`
          );
        }

        // Handle query building errors
        if (error instanceof Error && error.message.includes("metadata")) {
          throw new McpError(ErrorCode.InvalidParams, error.message);
        }

        // Handle unexpected errors
        throw new McpError(
          ErrorCode.InternalError,
          `Unexpected error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    case "create_credit_note": {
      const invoiceId = args?.invoice_id as string;
      const memo = args?.memo as string | undefined;
      const reason = args?.reason as string | undefined;

      // Validate invoice_id parameter
      if (!invoiceId) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Missing required parameter: invoice_id"
        );
      }

      // Validate invoice_id format
      if (!invoiceId.startsWith("in_")) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Invalid invoice_id format. Invoice IDs must start with 'in_'"
        );
      }

      // Validate reason enum if provided
      if (reason) {
        const validReasons = [
          "duplicate",
          "fraudulent",
          "order_change",
          "product_unsatisfactory",
        ];
        if (!validReasons.includes(reason)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid reason. Must be one of: ${validReasons.join(", ")}`
          );
        }
      }

      try {
        // Log attempt to stderr for debugging
        console.error(
          `Attempting to create credit note for invoice: ${invoiceId}`
        );

        // First, fetch the invoice to get its total amount
        console.error(`Fetching invoice details for: ${invoiceId}`);
        const invoice = await stripe.invoices.retrieve(invoiceId);

        // Build credit note parameters
        const creditNoteParams: Stripe.CreditNoteCreateParams = {
          invoice: invoiceId,
          amount: invoice.total, // Credit the full invoice amount
        };

        // Add optional parameters
        if (memo) {
          creditNoteParams.memo = memo;
        }
        if (reason) {
          creditNoteParams.reason =
            reason as Stripe.CreditNoteCreateParams.Reason;
        }

        console.error(
          `Creating credit note for ${invoice.total} cents (${invoice.currency})`
        );

        // Create credit note via Stripe API
        const creditNote = await stripe.creditNotes.create(creditNoteParams);

        // Format response
        const formattedText = formatCreditNoteResponse(creditNote);

        return {
          content: [{ type: "text", text: formattedText }],
        };
      } catch (error) {
        // Log full error to stderr for debugging
        console.error("Error creating credit note:", error);

        // Re-throw McpErrors as-is
        if (error instanceof McpError) {
          throw error;
        }

        // Handle Stripe-specific errors with detailed information
        if (error instanceof Stripe.errors.StripeError) {
          // Build detailed error message
          const errorDetails = [
            `Stripe API Error: ${error.message}`,
            `Error Type: ${error.type}`,
            `Error Code: ${error.code || "N/A"}`,
          ];

          if (error.statusCode) {
            errorDetails.push(`HTTP Status: ${error.statusCode}`);
          }

          if (error.requestId) {
            errorDetails.push(`Request ID: ${error.requestId}`);
          }

          // Add parameter information for context
          errorDetails.push(`Invoice ID: ${invoiceId}`);
          if (memo) errorDetails.push(`Memo: ${memo}`);
          if (reason) errorDetails.push(`Reason: ${reason}`);

          const detailedMessage = errorDetails.join(" | ");

          // Categorize by error type
          if (error.type === "StripeInvalidRequestError") {
            // Common specific error scenarios
            if (error.message.includes("No such invoice")) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invoice not found: ${invoiceId}. ${detailedMessage}`
              );
            }
            if (error.message.includes("already has a credit note")) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invoice ${invoiceId} already has a credit note or cannot be credited. ${detailedMessage}`
              );
            }
            if (error.message.includes("not paid")) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invoice ${invoiceId} must be paid before creating a credit note. ${detailedMessage}`
              );
            }
            throw new McpError(ErrorCode.InvalidParams, detailedMessage);
          }

          if (error.type === "StripeAuthenticationError") {
            throw new McpError(
              ErrorCode.InternalError,
              `Authentication failed. Check STRIPE_API_KEY. ${detailedMessage}`
            );
          }

          if (error.type === "StripePermissionError") {
            throw new McpError(
              ErrorCode.InternalError,
              `Permission denied. API key may lack required permissions. ${detailedMessage}`
            );
          }

          if (error.type === "StripeRateLimitError") {
            throw new McpError(
              ErrorCode.InternalError,
              `Rate limit exceeded. Please retry after a short delay. ${detailedMessage}`
            );
          }

          // Generic Stripe error
          throw new McpError(ErrorCode.InternalError, detailedMessage);
        }

        // Handle unexpected errors
        const errorMessage =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : `Unknown error: ${String(error)}`;

        throw new McpError(
          ErrorCode.InternalError,
          `Unexpected error creating credit note for invoice ${invoiceId}: ${errorMessage}`
        );
      }
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
