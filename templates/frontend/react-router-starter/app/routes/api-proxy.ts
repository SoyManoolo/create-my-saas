import { proxyBackendRequest } from "../lib/api-proxy.server";

export function loader({ request }: { request: Request }) {
  return proxyBackendRequest(request);
}

export function action({ request }: { request: Request }) {
  return proxyBackendRequest(request);
}
