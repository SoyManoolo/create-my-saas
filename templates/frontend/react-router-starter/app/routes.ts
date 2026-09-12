import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("verify-email", "routes/verify-email.tsx"),
  route("auth/oauth/callback", "routes/oauth-callback.tsx"),
  route("app", "routes/app.tsx"),
  route("account", "routes/account.tsx"),
  route("auth/*", "routes/auth-proxy.ts"),
  route("users/*", "routes/users-proxy.ts"),
] satisfies RouteConfig;
