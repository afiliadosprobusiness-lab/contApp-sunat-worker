import fs from "fs";
import path from "path";
import readline from "readline";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import unzipper from "unzipper";
import { firestore, firebaseAdmin } from "../firebase.js";

const CACHE_DAYS = Number(process.env.SUNAT_RUC_CACHE_TTL_DAYS || 7);
const CACHE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;
const PADRON_CACHE_HOURS = Number(process.env.SUNAT_PADRON_CACHE_HOURS || 24);
const PADRON_PAGE_URL =
  process.env.SUNAT_PADRON_PAGE_URL || "https://www.sunat.gob.pe/descargaPRR/mrc137_padron_reducido.html";

const TMP_DIR = process.env.TMPDIR || "/tmp";
const PADRON_ZIP_PATH = path.join(TMP_DIR, "padron_reducido_RUC.zip");
const PADRON_TXT_PATH = path.join(TMP_DIR, "padron_reducido_RUC.txt");

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

const inferType = (ruc) => {
  if (ruc.startsWith("10")) return "Persona Natural";
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

const isFileFresh = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return Date.now() - stats.mtimeMs <= PADRON_CACHE_HOURS * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

const getPadronDownloadUrl = async () => {
  const res = await fetch(PADRON_PAGE_URL);
  if (!res.ok) {
    throw new Error("No se pudo obtener el enlace de descarga del padron.");
  }
  const html = await res.text();
  const match = html.match(/href="([^"]*padron[^"]*ruc[^"]*\.zip)"/i);
  if (!match) {
    throw new Error("No se encontro el enlace del padron reducido.");
  }
  const raw = match[1];
  const url = new URL(raw, PADRON_PAGE_URL);
  return url.toString();
};

const downloadPadronZip = async () => {
  const url = await getPadronDownloadUrl();
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error("No se pudo descargar el padron reducido.");
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(PADRON_ZIP_PATH));
};

const extractPadronTxt = async () => {
  const directory = await unzipper.Open.file(PADRON_ZIP_PATH);
  const entry =
    directory.files.find((file) => file.path.toLowerCase().endsWith(".txt")) ||
    directory.files.find((file) => file.path.toLowerCase().includes("padron"));
  if (!entry) {
    throw new Error("No se encontro archivo TXT en el padron reducido.");
  }
  await pipeline(entry.stream(), fs.createWriteStream(PADRON_TXT_PATH));
};

const ensurePadronFile = async () => {
  if (isFileFresh(PADRON_TXT_PATH)) return;
  await downloadPadronZip();
  await extractPadronTxt();
};

const lookupRucInPadron = async (ruc) => {
  await ensurePadronFile();
  const stream = fs.createReadStream(PADRON_TXT_PATH, { encoding: "latin1" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const parts = line.split("|");
    const lineRuc = parts[0];
    if (lineRuc === ruc) {
      const name = (parts[1] || "").trim();
      const status = (parts[2] || "").trim();
      const condition = (parts[3] || "").trim();
      const ubigeo = (parts[4] || "").trim();
      const address = (parts[5] || "").trim();
      rl.close();
      return { ruc: lineRuc, name, status, condition, ubigeo, address };
    }
  }
  return null;
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

  let payload;

  if (process.env.SUNAT_MOCK !== "false") {
    payload = buildMockPayload(normalized);
  } else {
    const record = await lookupRucInPadron(normalized);
    if (!record) {
      const error = new Error("RUC no encontrado en padron SUNAT.");
      error.status = 404;
      throw error;
    }
    payload = {
      ruc: record.ruc,
      name: record.name,
      type: inferType(record.ruc),
      status: record.status,
      condition: record.condition,
      ubigeo: record.ubigeo,
      address: record.address,
      source: "padron",
    };
  }

  await cacheRef.set(
    {
      ...payload,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return payload;
};

export { normalizeRuc, isValidRuc };
