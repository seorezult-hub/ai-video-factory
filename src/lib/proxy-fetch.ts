/**
 * proxiedFetch — fetch через HTTP прокси когда PROXY_URL задан.
 * Используется для провайдеров недоступных из РФ (OpenAI, Google, Runway).
 *
 * PROXY_URL формат: http://user:pass@host:port
 */

import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

let _agent: ProxyAgent | null = null;

function getAgent(): ProxyAgent | null {
  const proxyUrl = process.env.PROXY_URL;
  if (!proxyUrl) return null;
  if (!_agent) {
    _agent = new ProxyAgent(proxyUrl);
  }
  return _agent;
}

export async function proxiedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const agent = getAgent();

  if (!agent) {
    return fetch(url, options);
  }

  // undici fetch через ProxyAgent
  const undiciOptions: UndiciRequestInit = {
    method: options.method,
    headers: options.headers as UndiciRequestInit["headers"],
    body: options.body as UndiciRequestInit["body"],
    signal: options.signal as UndiciRequestInit["signal"],
    dispatcher: agent,
  };

  const res = await undiciFetch(url, undiciOptions);
  return res as unknown as Response;
}
