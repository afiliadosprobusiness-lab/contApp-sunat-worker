# ContApp Pe (SUNAT Worker) — Project Context

## Objetivo de negocio
Worker dedicado para SUNAT: guarda credenciales SOL (usuario secundario) de forma cifrada, consulta datos por RUC (padrón reducido) y sincroniza comprobantes con automatización (Playwright), escribiendo resultados en Firestore para consumo realtime del frontend.

## Tech Stack
- Runtime: Node.js (>= 20) en Cloud Run
- Framework: Express
- Automatización: Playwright
- Auth/DB: Firebase Admin SDK (Auth + Firestore)
- Deploy: Google Cloud Run

## Arquitectura (decisiones clave)
- Separación por responsabilidad:
  - Este worker solo hace SUNAT (navegación/descargas/sync).
  - El backend principal hace pagos y chat IA.
- Seguridad:
  - Credenciales SOL se cifran con `SUNAT_ENCRYPTION_KEY` (base64, 32 bytes).
  - Service Account y claves viven solo en Cloud Run.
- Operación:
  - Caching de padrón reducido (descarga y TTL configurable) para reducir latencia/costos.
  - `SUNAT_MOCK` permite pruebas sin tocar SUNAT real.
- CORS explícito:
  - `CORS_ORIGIN` restringe el frontend autorizado.

## Endpoints (alto nivel)
- `POST /sunat/credentials`
- `POST /sunat/certificate`
- `GET /sunat/certificate/status?businessId=...`
- `POST /sunat/ruc`
- `POST /sunat/sync`
- `GET /sunat/status?businessId=...`
- `POST /sunat/cpe/emit`

## Convenciones de código
- ESM (`type: module`).
- Fail-fast si faltan variables críticas (`FIREBASE_SERVICE_ACCOUNT`, `SUNAT_ENCRYPTION_KEY`).
- Respuestas y estados de sync diseñados para UI realtime (Firestore).

## Variables de entorno (resumen)
- `FIREBASE_SERVICE_ACCOUNT`
- `SUNAT_ENCRYPTION_KEY`
- `CORS_ORIGIN`
- `SUNAT_MOCK`
- Cache/URLs/timeouts (ver `README.md`)
- `CPE_PROVIDER`
- `CPE_HTTP_URL`, `CPE_HTTP_TOKEN`, `CPE_HTTP_API_KEY`
- `CPE_HTTP_TIMEOUT_MS`
- `SUNAT_CPE_ENV`
- `SUNAT_SOAP_TIMEOUT_MS`

## Actualizacion 2026-02-15 (fase CPE)

### Emision CPE por provider
- Se agrega modulo `src/sunat/cpe.js` con estrategia por provider:
  - `MOCK` (default): respuesta aceptada simulada.
  - `HTTP`: envia payload normalizado a proveedor externo (`CPE_HTTP_URL`).
  - `SUNAT`: emision directa via SOAP billService (requiere SOL + certificado digital).
- El endpoint `POST /sunat/cpe/emit`:
  - carga negocio + factura desde Firestore (`invoices`)
  - emite CPE con `emitCpe`
  - persiste resultado en la factura (`cpeBeta*` o `cpe*` segun `env`, ticket/cdr, errores, timestamps)
