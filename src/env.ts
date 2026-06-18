import * as fs from "node:fs";
import * as path from "node:path";
import { Signer } from "@lendasat/lendaswap-sdk-pure";

const ENV_PATH = path.resolve(process.cwd(), ".env");

/**
 * Load or generate a BIP39 mnemonic, persisting it in .env
 */
export async function loadOrCreateMnemonic(): Promise<string> {
  // Check if .env exists and has MNEMONIC
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, "utf-8");
    const match = content.match(/^MNEMONIC="?([^"]+)"?$/m);
    if (match?.[1].trim()) {
      const mnemonic = match[1].trim();
      console.log("Loaded existing mnemonic from .env");
      return mnemonic;
    }
  }

  // Generate new mnemonic
  const signer = Signer.generate(12);
  const mnemonic = signer.mnemonic;
  if (!mnemonic) {
    throw new Error("Failed to generate mnemonic from new signer.");
  }

  // Write to .env (append if file exists, create if not)
  const line = `MNEMONIC="${mnemonic}"\n`;
  if (fs.existsSync(ENV_PATH)) {
    fs.appendFileSync(ENV_PATH, line);
  } else {
    fs.writeFileSync(ENV_PATH, line);
  }

  console.log("Generated new mnemonic and saved to .env");
  console.log(
    "IMPORTANT: Back up your .env file! It contains your recovery seed phrase.",
  );

  return mnemonic;
}
