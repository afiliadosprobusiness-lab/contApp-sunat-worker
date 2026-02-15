import forge from "node-forge";

const normalizePem = (pem) => String(pem || "").trim().replace(/\r\n/g, "\n");

export const parsePfxToPem = ({ pfxBase64, passphrase }) => {
  if (!pfxBase64) {
    throw new Error("Missing PFX");
  }
  const password = String(passphrase || "");
  if (!password) {
    throw new Error("Missing certificate password");
  }

  const derBytes = forge.util.decode64(String(pfxBase64).trim());
  const asn1 = forge.asn1.fromDer(derBytes);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })?.[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })?.[forge.pki.oids.certBag] || [];

  const keyBag = keyBags[0];
  const certBag = certBags[0];

  if (!keyBag?.key) {
    throw new Error("Certificate does not include a private key");
  }
  if (!certBag?.cert) {
    throw new Error("Certificate is missing");
  }

  const privateKeyPem = normalizePem(forge.pki.privateKeyToPem(keyBag.key));
  const certificatePem = normalizePem(forge.pki.certificateToPem(certBag.cert));

  return { privateKeyPem, certificatePem };
};

