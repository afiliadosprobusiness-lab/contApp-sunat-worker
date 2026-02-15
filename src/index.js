import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { firebaseAdmin, firestore } from "./firebase.js";
import { encryptPayload, decryptPayload } from "./crypto.js";
import { syncSunat } from "./sunat/sync.js";
import { lookupRuc, normalizeRuc, isValidRuc } from "./sunat/ruc.js";
import { emitCpe } from "./sunat/cpe.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
}));
// Certificates (PFX/P12) are uploaded as base64, so we need a bit more headroom.
app.use(express.json({ limit: "4mb" }));

const MAX_CERT_BYTES = 256 * 1024; // keep well under Firestore 1MiB doc limit after encryption/metadata

const stripDataUrlPrefix = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const marker = "base64,";
  const idx = raw.indexOf(marker);
  return idx >= 0 ? raw.slice(idx + marker.length) : raw;
};

const isBase64Like = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (raw.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(raw);
};

const sha256Base64 = (buffer) => {
  return crypto.createHash("sha256").update(buffer).digest("base64");
};

const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer " ) ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(token);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/sunat/credentials", requireAuth, async (req, res) => {
  const { businessId, ruc, solUser, solPassword } = req.body || {};

  if (!businessId || !ruc || !solUser || !solPassword) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const payload = encryptPayload({ ruc, solUser, solPassword });
    const ref = firestore.collection("users").doc(req.user.uid).collection("sunat_credentials").doc(businessId);

    await ref.set({
      encrypted: payload,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Could not store credentials" });
  }
});

app.post("/sunat/certificate", requireAuth, async (req, res) => {
  const businessId = String(req.body?.businessId || "").trim();
  const filename = String(req.body?.filename || "").trim();
  const password = String(req.body?.pfxPassword || "").trim();
  const base64 = stripDataUrlPrefix(req.body?.pfxBase64);

  if (!businessId || !base64 || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }
  if (!isBase64Like(base64)) {
    return res.status(400).json({ error: "Invalid certificate encoding" });
  }

  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) {
    return res.status(400).json({ error: "Invalid certificate file" });
  }
  if (bytes.length > MAX_CERT_BYTES) {
    return res.status(413).json({ error: "Certificate too large" });
  }

  const uid = req.user.uid;
  const businessRef = firestore.collection("users").doc(uid).collection("businesses").doc(businessId);
  const businessSnap = await businessRef.get();
  if (!businessSnap.exists) {
    return res.status(404).json({ error: "Business not found" });
  }

  try {
    const encrypted = encryptPayload({
      pfxBase64: base64,
      pfxPassword: password,
    });

    const ref = firestore.collection("users").doc(uid).collection("sunat_certificates").doc(businessId);
    await ref.set(
      {
        encrypted,
        filename: filename || null,
        sizeBytes: bytes.length,
        sha256: sha256Base64(bytes),
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Could not store certificate" });
  }
});

app.get("/sunat/certificate/status", requireAuth, async (req, res) => {
  const businessId = String(req.query?.businessId || "").trim();
  if (!businessId) {
    return res.status(400).json({ error: "Missing businessId" });
  }

  const uid = req.user.uid;
  const ref = firestore.collection("users").doc(uid).collection("sunat_certificates").doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) {
    return res.json({ ok: true, configured: false });
  }

  const data = snap.data() || {};
  return res.json({
    ok: true,
    configured: Boolean(data.encrypted),
    filename: data.filename || null,
    sizeBytes: data.sizeBytes || null,
    sha256: data.sha256 || null,
    updatedAt: data.updatedAt || null,
    createdAt: data.createdAt || null,
  });
});

app.post("/sunat/ruc", requireAuth, async (req, res) => {
  const { ruc } = req.body || {};
  const normalized = normalizeRuc(ruc);

  if (!normalized) {
    return res.status(400).json({ error: "Missing ruc" });
  }

  if (!isValidRuc(normalized)) {
    return res.status(400).json({ error: "RUC inválido" });
  }

  try {
    const data = await lookupRuc({ ruc: normalized });
    return res.json({ ok: true, data });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message || "No se pudo consultar el RUC" });
  }
});

app.post("/sunat/sync", requireAuth, async (req, res) => {
  const { businessId, year, month } = req.body || {};

  if (!businessId || !year || !month) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const statusRef = firestore.collection("users").doc(req.user.uid).collection("sunat_sync").doc(businessId);

  try {
    await statusRef.set({
      status: "RUNNING",
      lastPeriod: { year, month },
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const credRef = firestore.collection("users").doc(req.user.uid).collection("sunat_credentials").doc(businessId);
    const credSnap = await credRef.get();
    if (!credSnap.exists) {
      await statusRef.set({
        status: "ERROR",
        lastError: "Missing credentials",
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return res.status(400).json({ error: "Missing credentials" });
    }

    const encrypted = credSnap.data().encrypted;
    const credentials = decryptPayload(encrypted);

    const result = await syncSunat({
      uid: req.user.uid,
      businessId,
      credentials,
      year,
      month,
    });

    await statusRef.set({
      status: "OK",
      lastPeriod: { year, month },
      lastResult: result,
      lastRunAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.json({ ok: true, result });
  } catch (error) {
    await statusRef.set({
      status: "ERROR",
      lastError: error.message || "Unknown error",
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.status(500).json({ error: error.message || "Sync failed" });
  }
});

app.get("/sunat/status", requireAuth, async (req, res) => {
  const { businessId } = req.query;
  if (!businessId) {
    return res.status(400).json({ error: "Missing businessId" });
  }

  const ref = firestore.collection("users").doc(req.user.uid).collection("sunat_sync").doc(businessId);
  const snap = await ref.get();

  if (!snap.exists) {
    return res.json({ status: "IDLE" });
  }

  return res.json({ status: snap.data() });
});

app.post("/sunat/cpe/emit", requireAuth, async (req, res) => {
  const businessId = String(req.body?.businessId || "").trim();
  const invoiceId = String(req.body?.invoiceId || "").trim();

  if (!businessId || !invoiceId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const uid = req.user.uid;
  const businessRef = firestore.collection("users").doc(uid).collection("businesses").doc(businessId);
  const invoiceRef = businessRef.collection("invoices").doc(invoiceId);

  try {
    const credRef = firestore.collection("users").doc(uid).collection("sunat_credentials").doc(businessId);
    const certRef = firestore.collection("users").doc(uid).collection("sunat_certificates").doc(businessId);

    const [businessSnap, invoiceSnap, credSnap, certSnap] = await Promise.all([
      businessRef.get(),
      invoiceRef.get(),
      credRef.get(),
      certRef.get(),
    ]);

    if (!businessSnap.exists) {
      return res.status(404).json({ error: "Business not found" });
    }
    if (!invoiceSnap.exists) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    if (!credSnap.exists) {
      return res.status(400).json({ error: "Missing credentials" });
    }
    if (!certSnap.exists) {
      return res.status(400).json({ error: "Missing certificate" });
    }

    const sol = decryptPayload(credSnap.data()?.encrypted);
    const cert = decryptPayload(certSnap.data()?.encrypted);

    const result = await emitCpe({
      uid,
      businessId,
      invoiceId,
      business: businessSnap.data(),
      invoice: invoiceSnap.data(),
      sol,
      cert,
    });

    await invoiceRef.set({
      cpeStatus: result.status || "RECHAZADO",
      cpeProvider: result.provider || null,
      cpeTicket: result.ticket || null,
      cpeCode: result.cdr?.code ?? null,
      cpeDescription: result.cdr?.description ?? null,
      cpeZipBase64: result.cdr?.zipBase64 ?? null,
      cpeRaw: result.raw ?? null,
      cpeError: null,
      cpeLastAttemptAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      cpeAcceptedAt:
        result.status === "ACEPTADO"
          ? firebaseAdmin.firestore.FieldValue.serverTimestamp()
          : firebaseAdmin.firestore.FieldValue.delete(),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.status(200).json({ ok: true, result });
  } catch (error) {
    await invoiceRef.set({
      cpeStatus: "ERROR",
      cpeError: error?.message || "CPE emit failed",
      cpeLastAttemptAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => undefined);

    const status = Number(error?.status) || 500;
    const message = status >= 500 ? "CPE emit failed" : error?.message || "CPE emit failed";
    return res.status(status).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`SUNAT worker running on port ${port}`);
});
