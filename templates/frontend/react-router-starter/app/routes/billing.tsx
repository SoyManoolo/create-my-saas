import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedRoute } from "../components/protected-route";
import { api, type BillingConfiguration, type BillingSubscription, type Organization } from "../lib/api.client";
import { useAuth } from "../lib/auth-context";
import { privatePageMetadata } from "../lib/seo";

function entitlement(limit: number | null) { return limit === null ? "Sin límite" : `${limit} incluidos`; }

export function meta() { return privatePageMetadata({ title: "Facturación | SaaS starter", description: "Gestiona los planes y la suscripción de tu organización.", path: "/billing" }); }

export default function Billing() {
  const { getAccessToken } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [configuration, setConfiguration] = useState<BillingConfiguration>();
  const [subscription, setSubscription] = useState<BillingSubscription>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();

  const loadBilling = useCallback(async (id: string) => {
    setLoading(true); setMessage(undefined);
    try {
      const token = getAccessToken();
      const [nextConfiguration, nextSubscription] = await Promise.all([api.billingConfiguration(id, token), api.billingSubscription(id, token)]);
      setConfiguration(nextConfiguration); setSubscription(nextSubscription);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se ha podido cargar la facturación."); }
    finally { setLoading(false); }
  }, [getAccessToken]);

  useEffect(() => { void (async () => {
    try {
      const nextOrganizations = await api.organizations(getAccessToken());
      setOrganizations(nextOrganizations); setOrganizationId(nextOrganizations[0]?.id ?? "");
      if (!nextOrganizations.length) setLoading(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se han podido cargar las organizaciones."); setLoading(false); }
  })(); }, [getAccessToken]);
  useEffect(() => { if (organizationId) void loadBilling(organizationId); }, [organizationId, loadBilling]);

  async function redirect(kind: "checkout" | "portal", priceId?: string) {
    if (!organizationId) return;
    setPending(priceId ?? kind); setMessage(undefined);
    try {
      const token = getAccessToken();
      const result = kind === "checkout" && priceId ? await api.createCheckout(organizationId, priceId, token) : await api.createPortal(organizationId, token);
      if (result.url) { window.location.assign(result.url); return; }
      setMessage(result.reason ?? "La facturación de Stripe todavía no está configurada.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se ha podido abrir Stripe."); }
    finally { setPending(undefined); }
  }

  return <ProtectedRoute><AppShell><main className="dashboard"><p className="eyebrow">FACTURACIÓN</p><h1>Planes y suscripción</h1><p className="lead">Elige un plan para tu organización. El pago y la gestión de la suscripción se completan de forma segura en Stripe.</p>
    {organizations.length > 1 && <label className="billing-select">Organización<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
    {!loading && !organizationId && <section className="empty"><h2>No hay una organización disponible</h2><p>Crea o acepta una organización antes de configurar su facturación.</p></section>}
    {subscription && <section className="account-card billing-summary"><div><strong>Plan actual</strong><span>{subscription.plan} · {subscription.status}{subscription.cancelAtPeriodEnd ? " · cancela al final del periodo" : ""}</span></div><div><strong>Renovación</strong><span>{subscription.currentPeriodEnd ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(subscription.currentPeriodEnd)) : "Sin fecha"}</span></div><button className="button" type="button" onClick={() => void redirect("portal")} disabled={!configuration?.configured || Boolean(pending)}>{pending === "portal" ? "Abriendo…" : "Gestionar suscripción"}</button></section>}
    {message && <p className="error" role="status">{message}</p>}{loading && organizationId && <p className="success">Cargando facturación…</p>}
    {!loading && configuration?.configured && <section className="feature-grid billing-plans">{configuration.plans.map((plan) => <article key={plan.priceId}><strong>{plan.name}</strong><span>{Object.entries(plan.entitlements).map(([key, limit]) => `${key}: ${entitlement(limit)}`).join(" · ") || "Sin límites definidos"}</span><button className="button" type="button" onClick={() => void redirect("checkout", plan.priceId)} disabled={Boolean(pending)}>{pending === plan.priceId ? "Redirigiendo…" : "Elegir este plan"}</button></article>)}</section>}
    {!loading && configuration && !configuration.configured && <section className="empty"><h2>Facturación no configurada</h2><p>Configura Stripe y los planes permitidos en el backend para habilitar Checkout.</p></section>}
  </main></AppShell></ProtectedRoute>;
}
