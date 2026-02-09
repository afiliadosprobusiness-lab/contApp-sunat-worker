import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import readline from "readline";
import crypto from "crypto";
import unzipper from "unzipper";
import { firestore } from "../firebase.js";
import { Timestamp } from "firebase-admin/firestore";

const createMockComprobantes = async ({ uid, businessId, year, month }) => {
  const baseDate = new Date(year, month - 1, 15);
  const docRef = firestore.collection("users").doc(uid).collection("businesses").doc(businessId).collection("comprobantes");

  const ventas = [
    {
      type: "VENTA",
      serie: "F001",
      numero: `${Math.floor(Math.random() * 900 + 100)}`,
      fecha: Timestamp.fromDate(baseDate),
      cliente: "Cliente Demo SAC",
      monto: 1500,
      igv: 270,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
  ];

  const compras = [
    {
      type: "COMPRA",
      serie: "F002",
      numero: `${Math.floor(Math.random() * 900 + 100)}`,
      fecha: Timestamp.fromDate(baseDate),
      proveedor: "Proveedor Demo SAC",
      monto: 800,
      igv: 144,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
  ];

  const batch = firestore.batch();
  ventas.concat(compras).forEach((item) => {
    const doc = docRef.doc();
    batch.set(doc, item);
  });

  await batch.commit();
  return { ventas: ventas.length, compras: compras.length };
};

const DOWNLOAD_DIR = process.env.SUNAT_DOWNLOAD_DIR || "/tmp/sunat";
const LOGIN_URL = process.env.SUNAT_LOGIN_URL || "https://ww1.sunat.gob.pe/cl-ta-itmenuagrupa/MenuInternet.htm";
const ACTION_TIMEOUT = Number(process.env.SUNAT_SYNC_TIMEOUT_MS || 60000);

const REPORTS = [
  {
    type: "VENTA",
    envUrl: "SUNAT_VENTAS_URL",
    keywords: ["Ventas", "Comprobantes", "Emitidos", "CPE"],
  },
  {
    type: "COMPRA",
    envUrl: "SUNAT_COMPRAS_URL",
    keywords: ["Compras", "Comprobantes", "Recibidos", "CPE"],
  },
];

const ensureDir = () => {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
};

const normalizeText = (value = "") => value.toString().trim().toLowerCase();

const fillFirst = async (page, selectors, value) => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) {
      await locator.first().fill(value, { timeout: ACTION_TIMEOUT });
      return true;
    }
  }
  return false;
};

const clickFirst = async (page, selectors) => {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) {
      await locator.first().click({ timeout: ACTION_TIMEOUT });
      return true;
    }
  }
  return false;
};

const loginSol = async (page, { ruc, solUser, solPassword }) => {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: ACTION_TIMEOUT });

  const rucFilled = await fillFirst(page, ["input[name='ruc']", "input#txtRuc", "input[name='RUC']", "input[placeholder*='RUC']", "input[aria-label*='RUC']"], ruc);
  const userFilled = await fillFirst(page, ["input[name='usuario']", "input#txtUsuario", "input[name='user']", "input[placeholder*='Usuario']", "input[aria-label*='Usuario']"], solUser);
  const passFilled = await fillFirst(page, ["input[name='clave']", "input#txtClave", "input[type='password']", "input[placeholder*='Clave']", "input[aria-label*='Clave']"], solPassword);

  if (!rucFilled || !userFilled || !passFilled) {
    throw new Error("No se pudo completar el formulario SOL. Verifica la URL de login.");
  }

  await clickFirst(page, ["button:has-text('Iniciar sesión')", "input[type='submit']", "button:has-text('Iniciar Sesión')"]);
  await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT }).catch(() => null);

  const captcha = await page.locator("text=/casilla de seguridad|captcha|robot/i").first().isVisible().catch(() => false);
  if (captcha) {
    throw new Error("SOL requiere verificacion de seguridad (captcha). No se puede automatizar sin intervencion.");
  }
};

const tryOpenFromMenu = async (menuPage, keywords) => {
  for (const keyword of keywords) {
    const link = menuPage.getByRole("link", { name: new RegExp(keyword, "i") });
    if ((await link.count()) > 0) {
      const [popup] = await Promise.all([
        menuPage.waitForEvent("popup", { timeout: 5000 }).catch(() => null),
        link.first().click().catch(() => null),
      ]);
      if (popup) {
        await popup.waitForLoadState("domcontentloaded", { timeout: ACTION_TIMEOUT }).catch(() => null);
        return popup;
      }
      await menuPage.waitForLoadState("domcontentloaded", { timeout: ACTION_TIMEOUT }).catch(() => null);
      return menuPage;
    }
  }
  return null;
};

const setPeriod = async (page, year, month) => {
  const monthValue = String(month).padStart(2, "0");
  const monthInput = page.locator("input[type='month']");
  if ((await monthInput.count()) > 0) {
    await monthInput.first().fill(`${year}-${monthValue}`);
    return;
  }

  const yearSelect = page.locator("select[name*='anio'], select[name*='year'], select#anio, select#year");
  if ((await yearSelect.count()) > 0) {
    await yearSelect.first().selectOption(String(year));
  }

  const monthSelect = page.locator("select[name*='mes'], select[name*='month'], select#mes, select#month");
  if ((await monthSelect.count()) > 0) {
    await monthSelect.first().selectOption(monthValue);
  }
};

const triggerSearch = async (page) => {
  await clickFirst(page, [
    "button:has-text('Buscar')",
    "button:has-text('Consultar')",
    "button:has-text('Procesar')",
    "button:has-text('Generar')",
  ]);
};

const downloadReport = async ({ context, menuUrl, report, year, month }) => {
  const reportUrl = process.env[report.envUrl];
  const page = await context.newPage();
  let workingPage = page;

  if (reportUrl) {
    await workingPage.goto(reportUrl, { waitUntil: "domcontentloaded", timeout: ACTION_TIMEOUT });
  } else if (menuUrl) {
    await workingPage.goto(menuUrl, { waitUntil: "domcontentloaded", timeout: ACTION_TIMEOUT });
    const target = await tryOpenFromMenu(workingPage, report.keywords);
    if (!target) {
      await workingPage.close();
      throw new Error(`No se encontro la opcion de ${report.type} en SOL. Define ${report.envUrl}.`);
    }
    workingPage = target;
  } else {
    await workingPage.close();
    throw new Error(`No se encontro la opcion de ${report.type} en SOL. Define ${report.envUrl}.`);
  }

  await setPeriod(workingPage, year, month);
  await triggerSearch(workingPage);

  const downloadPromise = workingPage.waitForEvent("download", { timeout: ACTION_TIMEOUT * 2 }).catch(() => null);
  await clickFirst(workingPage, [
    "button:has-text('Descargar')",
    "button:has-text('Exportar')",
    "button:has-text('TXT')",
    "button:has-text('Excel')",
    "a:has-text('Descargar')",
    "a:has-text('Exportar')",
  ]);

  const download = await downloadPromise;
  if (!download) {
    throw new Error(`No se pudo descargar el reporte ${report.type}. Verifica la pantalla SOL.`);
  }

  ensureDir();
  const suggested = download.suggestedFilename();
  const targetPath = path.join(DOWNLOAD_DIR, `${Date.now()}-${report.type}-${suggested}`);
  await download.saveAs(targetPath);
  await workingPage.close();
  return targetPath;
};

const extractIfZip = async (filePath) => {
  if (path.extname(filePath).toLowerCase() !== ".zip") return filePath;
  const directory = await unzipper.Open.file(filePath);
  const entry = directory.files.find((file) => file.path.toLowerCase().endsWith(".txt") || file.path.toLowerCase().endsWith(".csv"));
  if (!entry) throw new Error("Zip sin archivo TXT/CSV.");
  const extracted = path.join(DOWNLOAD_DIR, `${Date.now()}-${path.basename(entry.path)}`);
  await new Promise((resolve, reject) => {
    entry.stream()
      .pipe(fs.createWriteStream(extracted))
      .on("finish", resolve)
      .on("error", reject);
  });
  return extracted;
};

const guessDelimiter = (line) => {
  if (line.includes("|")) return "|";
  if (line.includes(";")) return ";";
  if (line.includes(",")) return ",";
  return "|";
};

const normalizeHeader = (value) => normalizeText(value).replace(/\s+/g, " ");

const parseNumber = (value) => {
  const raw = value ? value.toString().trim() : "";
  if (!raw) return 0;
  let normalized = raw.replace(/[^\d,.-]/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseDate = (value) => {
  if (!value) return null;
  const text = value.toString().trim();
  const match = text.match(/(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  if (match) {
    const [, dd, mm, yyyy] = match;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  return null;
};

const parseDelimitedFile = async (filePath, reportType) => {
  const input = fs.createReadStream(filePath, { encoding: "latin1" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let headers = null;
  let delimiter = null;
  const rows = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!headers) {
      delimiter = guessDelimiter(line);
      headers = line.split(delimiter).map((h) => normalizeHeader(h.replace(/(^\"|\"$)/g, "")));
      continue;
    }
    const values = line.split(delimiter).map((v) => v.replace(/(^\"|\"$)/g, "").trim());
    rows.push(values);
  }

  if (!headers) return [];

  const findIndex = (patterns) => headers.findIndex((h) => patterns.some((p) => h.includes(p)));
  const idxSerie = findIndex(["serie"]);
  const idxNumero = findIndex(["numero", "nro"]);
  const idxFecha = findIndex(["fecha", "emision"]);
  const idxCliente = reportType === "VENTA" ? findIndex(["cliente", "adquirente", "razon"]) : -1;
  const idxProveedor = reportType === "COMPRA" ? findIndex(["proveedor", "emisor", "razon"]) : -1;
  const idxMonto = findIndex(["total", "importe", "monto"]);
  const idxIgv = findIndex(["igv", "impuesto"]);

  return rows.map((row) => {
    const serie = idxSerie >= 0 ? row[idxSerie] : "";
    const numero = idxNumero >= 0 ? row[idxNumero] : "";
    const fecha = idxFecha >= 0 ? parseDate(row[idxFecha]) : null;
    const monto = idxMonto >= 0 ? parseNumber(row[idxMonto]) : 0;
    const igv = idxIgv >= 0 ? parseNumber(row[idxIgv]) : 0;
    const cliente = idxCliente >= 0 ? row[idxCliente] : "";
    const proveedor = idxProveedor >= 0 ? row[idxProveedor] : "";

    return {
      type: reportType,
      serie,
      numero,
      fecha,
      monto,
      igv,
      cliente,
      proveedor,
      raw: row.join(delimiter || "|"),
    };
  });
};

const buildDocId = (payload) => {
  const parts = [
    payload.type,
    payload.serie,
    payload.numero,
    payload.fecha ? payload.fecha.toISOString().slice(0, 10) : "",
    payload.monto,
    payload.igv,
  ];
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
};

const storeComprobantes = async ({ uid, businessId, items }) => {
  const ref = firestore.collection("users").doc(uid).collection("businesses").doc(businessId).collection("comprobantes");
  let total = 0;

  for (let i = 0; i < items.length; i += 400) {
    const batch = firestore.batch();
    const chunk = items.slice(i, i + 400);
    chunk.forEach((item) => {
      const id = buildDocId(item);
      const docRef = ref.doc(id);
      batch.set(
        docRef,
        {
          type: item.type,
          serie: item.serie || "",
          numero: item.numero || "",
          fecha: item.fecha ? Timestamp.fromDate(item.fecha) : null,
          cliente: item.type === "VENTA" ? item.cliente || "" : null,
          proveedor: item.type === "COMPRA" ? item.proveedor || "" : null,
          monto: item.monto || 0,
          igv: item.igv || 0,
          source: "SUNAT",
          updatedAt: Timestamp.now(),
          createdAt: Timestamp.now(),
          raw: item.raw || "",
        },
        { merge: true }
      );
    });
    await batch.commit();
    total += chunk.length;
  }
  return total;
};

export const syncSunat = async ({ uid, businessId, credentials, year, month }) => {
  if (process.env.SUNAT_MOCK !== "false") {
    return createMockComprobantes({ uid, businessId, year, month });
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    await loginSol(page, credentials);
    const menuUrl = page.url();

    const result = { ventas: 0, compras: 0, warnings: [] };
    for (const report of REPORTS) {
      const downloaded = await downloadReport({ context, menuUrl, report, year, month });
      const dataFile = await extractIfZip(downloaded);
      const parsed = await parseDelimitedFile(dataFile, report.type);
      const stored = await storeComprobantes({ uid, businessId, items: parsed });

      if (report.type === "VENTA") result.ventas = stored;
      if (report.type === "COMPRA") result.compras = stored;
    }

    await page.close();
    await context.close();
    return result;
  } finally {
    await browser.close();
  }
};
