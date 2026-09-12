const HOP_BY_HOP_HEADERS = ["connection", "content-length", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

function backendUrl(request: Request): URL {
  const target = process.env.API_PROXY_TARGET;
  if (!target) throw new Response("API_PROXY_TARGET no está configurado.", { status: 500 });

  let origin: URL;
  try {
    origin = new URL(target);
  } catch {
    throw new Response("API_PROXY_TARGET debe ser una URL http(s) válida.", { status: 500 });
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Response("API_PROXY_TARGET debe usar http o https.", { status: 500 });
  }

  const incoming = new URL(request.url);
  return new URL(`${incoming.pathname}${incoming.search}`, origin);
}

function forwardHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);
  return headers;
}

export async function proxyBackendRequest(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const backendResponse = await fetch(backendUrl(request), {
    method,
    headers: forwardHeaders(request.headers),
    body,
    redirect: "manual",
  });

  const headers = forwardHeaders(backendResponse.headers);
  // Node's fetch has already decoded the body, so these would no longer match.
  headers.delete("content-encoding");
  const getSetCookie = (backendResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie?.call(backendResponse.headers) ?? [];
  headers.delete("set-cookie");
  for (const cookie of cookies) headers.append("set-cookie", cookie);

  return new Response(backendResponse.body, { status: backendResponse.status, statusText: backendResponse.statusText, headers });
}
