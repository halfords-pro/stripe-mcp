# Stripe MCP Server

A Model Context Protocol (MCP) server that provides Stripe integration for Claude.

## Overview

This MCP server enables Claude to interact with Stripe's API, allowing you to manage payments, customers, subscriptions, and other Stripe resources directly through conversation.

## Features

- **Tools**: Execute Stripe operations via Claude
- **Resources**: Access Stripe data and information

## Installation

```bash
npm install
npm run build
```

## Configuration

### Add to Claude Desktop

Add this server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "stripe": {
      "command": "node",
      "args": ["/absolute/path/to/stripe-mcp/dist/index.js"],
      "env": {
        "STRIPE_API_KEY": "your_stripe_api_key_here"
      }
    }
  }
}
```

### Environment Variables

- `STRIPE_API_KEY`: Your Stripe secret API key (required)

## Usage

Once configured, Claude will automatically have access to Stripe tools and resources. You can ask Claude to:

- Create and manage customers
- Process payments
- Handle subscriptions
- Retrieve transaction data
- Manage products and pricing
- And more...

## Development

```bash
# Build the project
npm run build

# Watch mode for development
npm run dev

# Run the server
npm start
```

## Example Interactions

Ask Claude things like:

- "Show me recent Stripe payments"
- "Create a new customer with email user@example.com"
- "List all active subscriptions"
- "Retrieve details for charge ch_xxx"

## Requirements

- Node.js >= 18.0.0
- Stripe API key
- Claude Desktop app

## License

MIT
