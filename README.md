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

## Endpoints
- `POST /sunat/credentials`
- `POST /sunat/sync`
- `GET /sunat/status?businessId=...`

## Modo mock (para pruebas)
- `SUNAT_MOCK=true` crea comprobantes de prueba en Firestore.

## Deploy (Cloud Run)
1. Construir imagen: `gcloud builds submit --tag gcr.io/PROJECT_ID/contapp-sunat-worker`
2. Desplegar: `gcloud run deploy contapp-sunat-worker --image gcr.io/PROJECT_ID/contapp-sunat-worker --region us-central1 --allow-unauthenticated`
3. Configurar variables de entorno en Cloud Run
