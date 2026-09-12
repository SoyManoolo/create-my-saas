import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import styles from "../product.module.css";

export default function SettingsPage(){return <ProtectedPage><AppShell><section className={styles.content}><p className={styles.eyebrow}>CONFIGURACIÓN</p><h1>Espacio de trabajo</h1><p className={styles.lead}>Ajusta la configuración común que cualquier producto puede necesitar.</p><div className={styles.empty}><div>⚙</div><h2>Configuración preparada</h2><p>Añade preferencias del producto, integraciones, equipos u organizaciones solo cuando el dominio de tu SaaS lo requiera.</p></div></section></AppShell></ProtectedPage>}
