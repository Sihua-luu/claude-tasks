import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3000';

const server = new McpServer({
  name: 'claude-tasks',
  version: '0.1.0',
});

// task.create@v1
server.tool(
  'task.create@v1',
  'Create a scheduled task. Use when the user wants to do something at a specific time or on a recurring basis.',
  {
    action: z.enum(['summarize_news', 'send_email', 'call_llm']),
    job_params: z.object({
      type: z.enum(['immediate', 'one-time', 'recurring']).default('immediate'),
      time: z.string().datetime().optional(),
      schedule: z.string().optional(),
    }),
  },
  async ({ action, job_params }) => {
    const res = await fetch(`${API_BASE}/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, job_params }),
    });
    const data = await res.json();
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// task.list@v1
server.tool(
  'task.list@v1',
  'List tasks the user has created. Can filter by status or time range.',
  {
    status: z.string().optional(),
    start_time: z.string().datetime().optional(),
    end_time: z.string().datetime().optional(),
    page: z.string().optional(),
    pageSize: z.number().int().min(1).max(100).default(20),
  },
  async (params) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.start_time) query.set('start_time', params.start_time);
    if (params.end_time) query.set('end_time', params.end_time);
    if (params.page) query.set('page', params.page);
    query.set('pageSize', params.pageSize.toString());

    const res = await fetch(`${API_BASE}/v1/jobs?${query}`);
    const data = await res.json();
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// task.cancel@v1
server.tool(
  'task.cancel@v1',
  'Cancel a task that has not yet executed or stop a recurring task.',
  {
    job_id: z.string(),
  },
  async ({ job_id }) => {
    const res = await fetch(`${API_BASE}/v1/jobs/${job_id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Server running on stdio');
}

main().catch((err) => {
  console.error('MCP Server failed:', err);
  process.exit(1);
});
