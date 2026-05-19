/**
 * Generates public/favicon.ico from public/brand-logo.svg (16px + 32px PNG embedded).
 * Run: npm run gen:favicon
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import toIco from "to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "public", "brand-logo.svg");
const outPath = path.join(root, "public", "favicon.ico");

async function main() {
  if (!fs.existsSync(svgPath)) {
    console.error("Missing:", svgPath);
    process.exit(1);
  }
  const base = sharp(svgPath).flatten({ background: "#ffffff" });
  const buf16 = await base
    .clone()
    .resize(16, 16, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  const buf32 = await base
    .clone()
    .resize(32, 32, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  const ico = await toIco([buf16, buf32]);
  fs.writeFileSync(outPath, ico);
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
