import JSZip from "jszip";

export const buildZipBase64 = async ({ filename, content }) => {
  const name = String(filename || "").trim();
  if (!name) throw new Error("Missing zip filename");
  const zip = new JSZip();
  zip.file(name, content);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buffer.toString("base64");
};

