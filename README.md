# ContApp Pe - SUNAT Worker

Backend serverless para sincronizar comprobantes de SUNAT usando Playwright.

## Requisitos
- Node 20+
- Google Cloud Run (recomendado)
- Firebase Admin SDK

## Variables de entorno
- `SUNAT_ENCRYPTION_KEY`: clave base64 de 32 bytes para cifrar credenciales.
- `FIREBASE_SERVICE_ACCOUNT`: JSON del service account (string en una sola linea).
- `CORS_ORIGIN`: origen permitido (ej: `https://contapp-pe.vercel.app`).
- `SUNAT_RUC_CACHE_TTL_DAYS`: dias de cache para consultas RUC (default: 7).
- `SUNAT_PADRON_CACHE_HOURS`: horas de cache para el archivo padron reducido (default: 24).
- `SUNAT_PADRON_PAGE_URL`: URL oficial del padron reducido (default: SUNAT).
- `SUNAT_LOGIN_URL`: URL de login SOL (default: SUNAT).
- `SUNAT_VENTAS_URL`: URL directa al reporte de ventas (opcional, recomendado).
- `SUNAT_COMPRAS_URL`: URL directa al reporte de compras (opcional, recomendado).
- `SUNAT_SYNC_TIMEOUT_MS`: timeout para pasos de automatizacion (default: 60000).
- `CPE_PROVIDER`: `MOCK` (default) o `HTTP`.
- `CPE_HTTP_URL`: endpoint del proveedor CPE (requerido si `CPE_PROVIDER=HTTP`).
- `CPE_HTTP_TOKEN`: bearer token opcional para proveedor CPE HTTP.
- `CPE_HTTP_API_KEY`: API key opcional para proveedor CPE HTTP.
- `CPE_HTTP_TIMEOUT_MS`: timeout de emision CPE HTTP (default: 45000).
- `SUNAT_CPE_ENV`: `BETA` (default) o `PROD` para emision directa a SUNAT (SOAP billService).
- `SUNAT_SOAP_TIMEOUT_MS`: timeout para requests SOAP a SUNAT (default: 45000).

## Endpoints
- `POST /sunat/credentials`
- `POST /sunat/certificate`
- `GET /sunat/certificate/status?businessId=...`
- `POST /sunat/ruc`
- `POST /sunat/sync`
- `GET /sunat/status?businessId=...`
- `POST /sunat/cpe/emit`

## Modo mock (para pruebas)
- `SUNAT_MOCK=true` crea comprobantes de prueba en Firestore.
- Para consulta RUC real, usa `SUNAT_MOCK=false` (descarga padron reducido de SUNAT).
- Para sincronizacion real, `SUNAT_MOCK=false` y define URLs directas si la navegacion automatica no encuentra el menu.

## Deploy (Cloud Run)
1. Construir imagen: `gcloud builds submit --tag gcr.io/PROJECT_ID/contapp-sunat-worker`
2. Desplegar: `gcloud run deploy contapp-sunat-worker --image gcr.io/PROJECT_ID/contapp-sunat-worker --region us-central1 --allow-unauthenticated`
3. Configurar variables de entorno en Cloud Run
