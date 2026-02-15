import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

const firstOrThrow = (nodes, message) => {
  if (!nodes || !nodes.length) throw new Error(message);
  return nodes[0];
};

export const signUblXml = ({ xml, privateKeyPem, certificatePem }) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  // UBL signature target: the first ExtensionContent under UBLExtensions.
  const extensionContent = firstOrThrow(
    doc.getElementsByTagName("ext:ExtensionContent"),
    "Missing ext:ExtensionContent for signature"
  );

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
  });

  // Use enveloped signature, reference the whole document.
  sig.addReference("//*[local-name()='Invoice']", ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"]);
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";

  sig.computeSignature(xml, {
    prefix: "ds",
    location: { reference: "//*[local-name()='ExtensionContent']", action: "append" },
  });

  // Ensure Signature has Id expected by UBL external reference.
  const signedXml = sig.getSignedXml();
  if (!signedXml.includes('Id="SignatureSP"')) {
    // xml-crypto emits <ds:Signature> without Id; patch in a stable way.
    return signedXml.replace("<ds:Signature", '<ds:Signature Id="SignatureSP"');
  }
  return signedXml;
};

