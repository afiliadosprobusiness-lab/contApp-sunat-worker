import { DOMParser } from "@xmldom/xmldom";

const SOAP_TIMEOUT_MS = Number(process.env.SUNAT_SOAP_TIMEOUT_MS || 45000);

const getBillServiceUrl = (requestedEnv) => {
  const env = String(requestedEnv || process.env.SUNAT_CPE_ENV || "BETA").trim().toUpperCase();
  if (env === "PROD") {
    return "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService";
  }
  return "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService";
};

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

const extractText = (doc, tagLocalName) => {
  const nodes = doc.getElementsByTagName(tagLocalName);
  if (nodes?.length) return String(nodes[0]?.textContent || "").trim();
  // Fallback: search by local-name with prefix variants.
  const any = doc.getElementsByTagName(`soapenv:${tagLocalName}`);
  if (any?.length) return String(any[0]?.textContent || "").trim();
  return "";
};

export const sendBillSoap = async ({ ruc, solUser, solPassword, zipFilename, zipBase64, env }) => {
  const username = `${String(ruc || "").trim()}${String(solUser || "").trim()}`;
  if (!username || !solPassword) {
    const error = new Error("Missing SOL credentials");
    error.status = 400;
    throw error;
  }

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password>${escapeXml(solPassword)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendBill>
      <fileName>${escapeXml(zipFilename)}</fileName>
      <contentFile>${escapeXml(zipBase64)}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>`;

  const response = await fetch(getBillServiceUrl(env), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
    body: envelope,
    signal: AbortSignal.timeout(SOAP_TIMEOUT_MS),
  });

  const text = await response.text();
  const doc = new DOMParser().parseFromString(text, "application/xml");

  // SOAP fault
  const fault = doc.getElementsByTagName("faultstring");
  if (fault?.length) {
    const message = String(fault[0]?.textContent || "SUNAT SOAP fault").trim();
    const error = new Error(message);
    error.status = 400;
    error.raw = text;
    throw error;
  }

  const appResp = extractText(doc, "applicationResponse") || extractText(doc, "ser:applicationResponse");
  if (!appResp) {
    const error = new Error("Missing applicationResponse from SUNAT");
    error.status = response.ok ? 500 : response.status;
    error.raw = text;
    throw error;
  }

  return { cdrZipBase64: appResp, rawXml: text };
};
