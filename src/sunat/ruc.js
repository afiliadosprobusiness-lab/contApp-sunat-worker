import { firestore, firebaseAdmin } from "../firebase.js";

const CACHE_DAYS = Number(process.env.SUNAT_RUC_CACHE_TTL_DAYS || 7);
const CACHE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;

const normalizeRuc = (value) => String(value || "").replace(/\D/g, "").slice(0, 11);

const isValidRuc = (ruc) => {
  if (!/^\d{11}$/.test(ruc)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + Number(ruc[index]) * weight, 0);
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? 1 : remainder === 10 ? 0 : remainder;
  return expected === Number(ruc[10]);
};

const mapMockType = (ruc) => {
  if (ruc.startsWith("10")) return "Persona Natural";
  if (ruc.startsWith("17")) return "SAA";
  if (ruc.startsWith("20")) return "SAC";
  if (ruc.startsWith("21")) return "SRL";
  if (ruc.startsWith("30")) return "Cooperativa";
  return "Otro";
};

const buildMockPayload = (ruc) => {
  return {
    ruc,
    name: `Empresa ${ruc.slice(-4)}`,
    type: mapMockType(ruc),
    status: "ACTIVO",
    condition: "HABIDO",
    source: "mock",
  };
};

const isCacheFresh = (payload) => {
  const updatedAt = payload?.updatedAt?.toDate?.();
  if (!updatedAt) return false;
  return Date.now() - updatedAt.getTime() <= CACHE_MS;
};

export const lookupRuc = async ({ ruc }) => {
  const normalized = normalizeRuc(ruc);
  if (!isValidRuc(normalized)) {
    const error = new Error("RUC inválido");
    error.status = 400;
    throw error;
  }

  const cacheRef = firestore.collection("sunat_ruc_cache").doc(normalized);
  const cacheSnap = await cacheRef.get();
  if (cacheSnap.exists) {
    const cached = cacheSnap.data();
    if (isCacheFresh(cached)) {
      return { ...cached, source: cached.source || "cache" };
    }
  }

  if (process.env.SUNAT_MOCK !== "false") {
    const payload = buildMockPayload(normalized);
    await cacheRef.set(
      {
        ...payload,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return payload;
  }

  throw new Error("SUNAT lookup not implemented. Set SUNAT_MOCK=true for testing.");
};

export { normalizeRuc, isValidRuc };
