"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { useAuth } from "../components/auth-provider";
import { api, type BillingConfiguration, type BillingSubscription, type Organization } from "../lib/api";
import styles from "../product.module.css";

function entitlement(limit: number | null) { return limit === null ? "Sin límite" : `${limit} incluidos`; }

export default function BillingPage() {
  const { getAccessToken } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [configuration, setConfiguration] = useState<BillingConfiguration>();
  const [subscription, setSubscription] = useState<BillingSubscription>();
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string>();

  const loadBilling = useCallback(async (id: string) => {
    setLoading(true); setNotice(undefined);
    try {
      const token = getAccessToken();
      const [nextConfiguration, nextSubscription] = await Promise.all([api.billingConfiguration(id, token), api.billingSubscription(id, token)]);
      setConfiguration(nextConfiguration); setSubscription(nextSubscription);
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se ha podido cargar la facturación."); }
    finally { setLoading(false); }
  }, [getAccessToken]);

  useEffect(() => {
    void (async () => {
      try {
        const nextOrganizations = await api.organizations(getAccessToken());
        setOrganizations(nextOrganizations); setOrganizationId(nextOrganizations[0]?.id ?? "");
        if (!nextOrganizations.length) setLoading(false);
      } catch (error) { setNotice(error instanceof Error ? error.message : "No se han podido cargar las organizaciones."); setLoading(false); }
    })();
  }, [getAccessToken]);

  useEffect(() => { if (organizationId) void loadBilling(organizationId); }, [organizationId, loadBilling]);

  async function redirect(kind: "checkout" | "portal", priceId?: string) {
    if (!organizationId) return;
    setPending(priceId ?? kind); setNotice(undefined);
    try {
      const token = getAccessToken();
      const result = kind === "checkout" && priceId ? await api.createCheckout(organizationId, priceId, token) : await api.createPortal(organizationId, token);
      if (result.url) { window.location.assign(result.url); return; }
      setNotice(result.reason ?? "La facturación de Stripe todavía no está configurada.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se ha podido abrir Stripe."); }
    finally { setPending(undefined); }
  }

  return <ProtectedPage><AppShell><section className={styles.content}>
    <p className={styles.eyebrow}>FACTURACIÓN</p><h1>Planes y suscripción</h1><p className={styles.lead}>Elige un plan para tu organización. El pago y la gestión de la suscripción se completan de forma segura en Stripe.</p>
    {organizations.length > 1 && <label>Organización<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
    {!loading && !organizationId && <div className={styles.empty}><h2>No hay una organización disponible</h2><p>Crea o acepta una organización antes de configurar su facturación.</p></div>}
    {subscription && <section className={styles.card}><div><span>Plan actual</span><strong>{subscription.plan}</strong><small>{subscription.status}{subscription.cancelAtPeriodEnd ? " · cancela al final del periodo" : ""}</small></div><div><span>Renovación</span><strong>{subscription.currentPeriodEnd ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(subscription.currentPeriodEnd)) : "Sin fecha"}</strong><small>{subscription.seats} plaza{subscription.seats === 1 ? "" : "s"}</small></div><button type="button" onClick={() => void redirect("portal")} disabled={!configuration?.configured || Boolean(pending)}>{pending === "portal" ? "Abriendo…" : "Gestionar suscripción"}</button></section>}
    {notice && <p className={styles.lead} role="status">{notice}</p>}
    {loading && organizationId && <p className={styles.lead}>Cargando facturación…</p>}
    {!loading && configuration?.configured && <div className={styles.grid}>{configuration.plans.map((plan) => <article className={styles.card} key={plan.priceId}><p>PLAN</p><h2>{plan.name}</h2><ul>{Object.entries(plan.entitlements).map(([key, limit]) => <li key={key}><strong>{key}</strong><span>{entitlement(limit)}</span></li>)}</ul><button type="button" onClick={() => void redirect("checkout", plan.priceId)} disabled={Boolean(pending)}>{pending === plan.priceId ? "Redirigiendo…" : "Elegir este plan"}</button></article>)}</div>}
    {!loading && configuration && !configuration.configured && <div className={styles.empty}><h2>Facturación no configurada</h2><p>Configura Stripe y los planes permitidos en el backend para habilitar Checkout.</p></div>}
  </section></AppShell></ProtectedPage>;
}
