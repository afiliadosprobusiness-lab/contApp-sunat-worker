import { chromium } from "playwright";
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

export const syncSunat = async ({ uid, businessId, credentials, year, month }) => {
  if (process.env.SUNAT_MOCK !== "false") {
    return createMockComprobantes({ uid, businessId, year, month });
  }

  // Placeholder for SUNAT automation. Implement login + download here.
  // Use Playwright to login to SOL and download reports for ventas/compras.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // TODO: implementar login SUNAT con credentials (ruc, solUser, solPassword)
    // TODO: navegar a reportes, descargar archivos y parsearlos
    // TODO: guardar comprobantes reales en Firestore

    await page.close();
    await context.close();
  } finally {
    await browser.close();
  }

  throw new Error("SUNAT automation not implemented yet. Set SUNAT_MOCK=true for testing.");
};
