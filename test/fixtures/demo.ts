import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import type { AgentMessage } from '../../src/services/demo-agent.js';

export async function serve(t: TestContext, server: Server): Promise<string> {
  t.after(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
}

interface ModelRequest {
  messages: AgentMessage[];
  authorization?: string;
}
type ModelReply = AgentMessage | { deltas: Record<string, unknown>[] };

export async function modelFixture(
  t: TestContext,
  reply: (request: ModelRequest, round: number) => ModelReply,
) {
  const requests: ModelRequest[] = [];
  const errors: unknown[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      const input: ModelRequest = {
        ...JSON.parse(Buffer.concat(chunks).toString('utf8')),
        authorization: request.headers.authorization,
      };
      requests.push(input);
      const result = reply(input, requests.length - 1);
      if ('deltas' in result) {
        response.setHeader('Content-Type', 'text/event-stream');
        for (const delta of result.deltas)
          response.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\r\n\r\n');
        response.end('data: [DONE]\n\n');
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ choices: [{ message: result }] }));
      }
    } catch (error) {
      errors.push(error);
      response.writeHead(500).end();
    }
  });
  const url = await serve(t, server);
  t.after(() => assert.deepEqual(errors, [], 'Mock model handler failed'));
  return { url, requests };
}

export function toolReply(id: string, name: string, input: unknown): AgentMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }],
  };
}

export async function chat(base: string, input: Record<string, unknown>): Promise<string> {
  const response = await fetch(base + '/api/chat', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 200);
  return response.text();
}
