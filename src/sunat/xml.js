export const escapeXml = (value) => {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

export const pickDocType = (documentTypeCode) => {
  if (documentTypeCode === "01") return "Invoice";
  if (documentTypeCode === "03") return "Invoice"; // Boleta still uses Invoice structure in UBL 2.1 for SUNAT
  return "Invoice";
};

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toDate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

// Minimal UBL 2.1 Invoice XML suitable as a starting point for SUNAT. SUNAT is strict; missing fields will be rejected.
export const buildUblInvoiceXml = ({ issuer, customer, invoice, totals, items }) => {
  const issueDate = toDate(invoice.issueDate) || toDate(new Date().toISOString());
  const id = `${invoice.serie}-${invoice.numero}`;

  const subtotal = round2(totals.subtotal);
  const igv = round2(totals.igv);
  const total = round2(totals.total);

  const currency = "PEN";
  const taxRate = 0.18;

  const linesXml = items
    .map((item, idx) => {
      const lineId = String(idx + 1);
      const qty = round2(item.quantity);
      const unitPrice = round2(item.unitPrice);
      const lineSubtotal = round2(item.subtotal);
      const lineIgv = round2(item.igv);
      const lineTotal = round2(item.total);

      return `
    <cac:InvoiceLine>
      <cbc:ID>${escapeXml(lineId)}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="NIU">${escapeXml(qty)}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${currency}">${escapeXml(lineSubtotal)}</cbc:LineExtensionAmount>
      <cac:PricingReference>
        <cac:AlternativeConditionPrice>
          <cbc:PriceAmount currencyID="${currency}">${escapeXml(unitPrice)}</cbc:PriceAmount>
          <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
        </cac:AlternativeConditionPrice>
      </cac:PricingReference>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${escapeXml(lineIgv)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="${currency}">${escapeXml(lineSubtotal)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="${currency}">${escapeXml(lineIgv)}</cbc:TaxAmount>
          <cac:TaxCategory>
            <cbc:Percent>${escapeXml(taxRate * 100)}</cbc:Percent>
            <cbc:TaxExemptionReasonCode>10</cbc:TaxExemptionReasonCode>
            <cac:TaxScheme>
              <cbc:ID>1000</cbc:ID>
              <cbc:Name>IGV</cbc:Name>
              <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
            </cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Description>${escapeXml(item.description)}</cbc:Description>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${currency}">${escapeXml(unitPrice)}</cbc:PriceAmount>
      </cac:Price>
    </cac:InvoiceLine>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${escapeXml(id)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(issueDate)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode listID="0101">${escapeXml(invoice.documentTypeCode)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>

  <cac:Signature>
    <cbc:ID>${escapeXml(issuer.ruc)}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>${escapeXml(issuer.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escapeXml(issuer.name)}</cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#SignatureSP</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6">${escapeXml(issuer.ruc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(issuer.name)}</cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID>${escapeXml(issuer.ubigeo)}</cbc:ID>
          <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>
          <cac:AddressLine>
            <cbc:Line>${escapeXml(issuer.addressLine1)}</cbc:Line>
          </cac:AddressLine>
          <cac:Country>
            <cbc:IdentificationCode>PE</cbc:IdentificationCode>
          </cac:Country>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${escapeXml(customer.schemeId)}">${escapeXml(customer.documentNumber)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(customer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${escapeXml(igv)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${escapeXml(subtotal)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${escapeXml(igv)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>1000</cbc:ID>
          <cbc:Name>IGV</cbc:Name>
          <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${escapeXml(subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${escapeXml(total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${escapeXml(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${linesXml}
</Invoice>`;
};

