const CPE_PROVIDER = String(process.env.CPE_PROVIDER || "MOCK").trim().toUpperCase();
const CPE_HTTP_TIMEOUT_MS = Number(process.env.CPE_HTTP_TIMEOUT_MS || 45000);

const asCpeError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const normalizeDocTypeCode = (documentType) => {
  const value = String(documentType || "").toUpperCase();
  if (value === "FACTURA") return "01";
  if (value === "BOLETA") return "03";
  return null;
};

const normalizeStatus = (status, accepted) => {
  const value = String(status || "").trim().toUpperCase();
  if (value.includes("ACEPT")) return "ACEPTADO";
  if (value.includes("RECH")) return "RECHAZADO";
  if (typeof accepted === "boolean") return accepted ? "ACEPTADO" : "RECHAZADO";
  return "RECHAZADO";
};

const normalizeCdr = (payload = {}) => {
  const code = payload?.code ?? payload?.cdrCode ?? payload?.responseCode ?? null;
  const description =
    payload?.description ??
    payload?.cdrDescription ??
    payload?.responseDescription ??
    payload?.message ??
    null;
  const zipBase64 = payload?.zipBase64 ?? payload?.cdrZipBase64 ?? payload?.cdr ?? null;
  return { code, description, zipBase64 };
};

const toIsoOrNull = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const ensureInvoicePayload = ({ business, invoice }) => {
  const docTypeCode = normalizeDocTypeCode(invoice?.documentType);
  if (!docTypeCode) {
    throw asCpeError(400, "Unsupported documentType for CPE");
  }

  const issuerRuc = String(business?.ruc || "").trim();
  if (!issuerRuc) {
    throw asCpeError(400, "Business RUC is required");
  }

  const issuerAddressLine1 = String(business?.addressLine1 || "").trim();
  const issuerUbigeo = String(business?.ubigeo || "").trim();
  if (!issuerAddressLine1 || !issuerUbigeo) {
    throw asCpeError(400, "Business issuer address (addressLine1, ubigeo) is required");
  }

  const serie = String(invoice?.serie || "").trim().toUpperCase();
  const numero = String(invoice?.numero || "").trim().toUpperCase();
  if (!serie || !numero) {
    throw asCpeError(400, "Invoice serie and numero are required");
  }

  if (!Array.isArray(invoice?.items) || invoice.items.length === 0) {
    throw asCpeError(400, "Invoice items are required");
  }

  return {
    documentTypeCode: docTypeCode,
    issuer: {
      ruc: issuerRuc,
      name: String(business?.name || "").trim(),
      addressLine1: issuerAddressLine1,
      ubigeo: issuerUbigeo,
    },
    invoice: {
      id: String(invoice?.id || "").trim(),
      documentType: String(invoice?.documentType || "").trim().toUpperCase(),
      serie,
      numero,
      issueDate: toIsoOrNull(invoice?.issueDate),
      dueDate: toIsoOrNull(invoice?.dueDate),
      customer: {
        name: String(invoice?.customerName || "").trim(),
        documentType: String(invoice?.customerDocumentType || "").trim().toUpperCase(),
        documentNumber: String(invoice?.customerDocumentNumber || "").trim(),
      },
      totals: {
        subtotal: Number(invoice?.subtotal || 0),
        igv: Number(invoice?.igv || 0),
        total: Number(invoice?.total || 0),
      },
      items: invoice.items.map((item) => ({
        description: String(item?.description || "").trim(),
        quantity: Number(item?.quantity || 0),
        unitPrice: Number(item?.unitPrice || 0),
        taxRate: Number(item?.taxRate || 0),
        subtotal: Number(item?.subtotal || 0),
        igv: Number(item?.igv || 0),
        total: Number(item?.total || 0),
      })),
    },
  };
};

const emitViaMock = async (payload) => {
  const ticket = `MOCK-${payload.invoice.serie}-${payload.invoice.numero}`;
  return {
    status: "ACEPTADO",
    provider: "MOCK",
    ticket,
    cdr: {
      code: "0",
      description: "Aceptado en entorno mock",
      zipBase64: null,
    },
    raw: {
      mock: true,
      ticket,
      accepted: true,
    },
  };
};

const emitViaHttp = async (payload) => {
  const url = String(process.env.CPE_HTTP_URL || "").trim();
  if (!url) {
    throw asCpeError(500, "Missing CPE_HTTP_URL");
  }

  const headers = {
    "Content-Type": "application/json",
  };
  const bearer = String(process.env.CPE_HTTP_TOKEN || "").trim();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const apiKey = String(process.env.CPE_HTTP_API_KEY || "").trim();
  if (apiKey) headers["x-api-key"] = apiKey;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(CPE_HTTP_TIMEOUT_MS),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw asCpeError(response.status, data?.error || data?.message || "CPE provider error");
  }

  const status = normalizeStatus(data?.status, data?.accepted ?? data?.ok);
  return {
    status,
    provider: "HTTP",
    ticket: data?.ticket || data?.externalId || data?.id || null,
    cdr: normalizeCdr(data?.cdr || data),
    raw: data,
  };
};

const customerSchemeId = (documentType) => {
  const value = String(documentType || "").trim().toUpperCase();
  if (value === "RUC") return "6";
  if (value === "DNI") return "1";
  return "0";
};

const decodeCdr = async (cdrZipBase64) => {
  // Keep it light: derive code/description from the response XML when possible.
  // If unzip fails, we still store the ZIP base64.
  try {
    const buffer = Buffer.from(String(cdrZipBase64 || ""), "base64");
    const unzipper = await import("unzipper");
    const directory = await unzipper.Open.buffer(buffer);
    const xmlEntry = directory.files.find((f) => f.path.toLowerCase().endsWith(".xml"));
    if (!xmlEntry) return { code: null, description: null };
    const xml = (await xmlEntry.buffer()).toString("utf8");
    const codeMatch = xml.match(/<ResponseCode>([^<]+)<\/ResponseCode>/i);
    const descMatch = xml.match(/<Description>([^<]+)<\/Description>/i);
    return {
      code: codeMatch ? codeMatch[1].trim() : null,
      description: descMatch ? descMatch[1].trim() : null,
    };
  } catch {
    return { code: null, description: null };
  }
};

const emitViaSunat = async (payload, { sol, cert, env }) => {
  const { buildUblInvoiceXml } = await import("./xml.js");
  const { parsePfxToPem } = await import("./certificate.js");
  const { signUblXml } = await import("./sign.js");
  const { buildZipBase64 } = await import("./zip.js");
  const { sendBillSoap } = await import("./soap.js");

  if (!sol?.ruc || !sol?.solUser || !sol?.solPassword) {
    throw asCpeError(400, "Missing SOL credentials for SUNAT emit");
  }
  if (!cert?.pfxBase64 || !cert?.pfxPassword) {
    throw asCpeError(400, "Missing digital certificate for SUNAT emit");
  }

  const xml = buildUblInvoiceXml({
    issuer: {
      ruc: payload.issuer.ruc,
      name: payload.issuer.name,
      addressLine1: payload.issuer.addressLine1,
      ubigeo: payload.issuer.ubigeo,
    },
    customer: {
      name: payload.invoice.customer.name,
      documentNumber: payload.invoice.customer.documentNumber,
      schemeId: customerSchemeId(payload.invoice.customer.documentType),
    },
    invoice: {
      documentTypeCode: payload.documentTypeCode,
      serie: payload.invoice.serie,
      numero: payload.invoice.numero,
      issueDate: payload.invoice.issueDate,
    },
    totals: payload.invoice.totals,
    items: payload.invoice.items,
  });

  const { privateKeyPem, certificatePem } = parsePfxToPem({
    pfxBase64: cert.pfxBase64,
    passphrase: cert.pfxPassword,
  });

  const signedXml = signUblXml({ xml, privateKeyPem, certificatePem });

  const baseName = `${sol.ruc}-${payload.documentTypeCode}-${payload.invoice.serie}-${payload.invoice.numero}`;
  const xmlFilename = `${baseName}.xml`;
  const zipFilename = `${baseName}.zip`;
  const zipBase64 = await buildZipBase64({ filename: xmlFilename, content: signedXml });

  const { cdrZipBase64, rawXml } = await sendBillSoap({
    ruc: sol.ruc,
    solUser: sol.solUser,
    solPassword: sol.solPassword,
    zipFilename,
    zipBase64,
    env,
  });

  const cdrMeta = await decodeCdr(cdrZipBase64);
  const accepted = String(cdrMeta.code || "").trim() === "0";

  return {
    status: accepted ? "ACEPTADO" : "RECHAZADO",
    provider: "SUNAT",
    ticket: null,
    cdr: { code: cdrMeta.code, description: cdrMeta.description, zipBase64: cdrZipBase64 },
    raw: { soap: rawXml, env: env || null },
  };
};

export const emitCpe = async ({ uid, businessId, invoiceId, business, invoice, sol, cert, sunatEnv }) => {
  const payload = ensureInvoicePayload({ business, invoice: { ...invoice, id: invoiceId } });
  const requestPayload = {
    uid,
    businessId,
    ...payload,
  };

  if (CPE_PROVIDER === "HTTP") {
    return emitViaHttp(requestPayload);
  }
  if (CPE_PROVIDER === "SUNAT") {
    return emitViaSunat(requestPayload, { sol, cert, env: sunatEnv });
  }
  return emitViaMock(requestPayload);
};
