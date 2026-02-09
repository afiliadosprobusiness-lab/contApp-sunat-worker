import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { firebaseAdmin, firestore } from "./firebase.js";
import { encryptPayload, decryptPayload } from "./crypto.js";
import { syncSunat } from "./sunat/sync.js";
import { lookupRuc, normalizeRuc, isValidRuc } from "./sunat/ruc.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
}));
app.use(express.json({ limit: "1mb" }));

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

app.listen(port, () => {
  console.log(`SUNAT worker running on port ${port}`);
});
