#!/usr/bin/env node

import fs from "fs";
import { Command } from "commander";

// CLI setup
const program = new Command();

program
  .name("ipfs-ops")
  .description("IPFS operations: Upload to Pinata and manage IPNS via Filebase")
  .version("1.0.0");

// Upload to Pinata command
program
  .command("upload-pinata")
  .description("Upload and pin directory to IPFS via Pinata")
  .option("-d, --dir <path>", "Directory to upload", "./public")
  .option("-j, --jwt <token>", "Pinata JWT token (or set PINATA_JWT env var)")
  .option("-a, --alias <name>", "Pin alias/name")
  .option("-c, --cid-version <version>", "CID version (0 or 1)", "1")
  .option("--no-cleanup", "Don't delete old pins with same alias")
  .addHelpText(
    "after",
    `
Examples:
  $ ipfs-ops upload-pinata --dir ./public --jwt YOUR_JWT --alias my-site
  $ PINATA_JWT=your_jwt ipfs-ops upload-pinata --dir ./dist --alias main
    `,
  )
  .action(async (options) => {
    const jwt = options.jwt || process.env.PINATA_JWT;

    if (!jwt) {
      console.error("✗ Error: Pinata JWT token is required");
      console.error(
        "  Provide it via --jwt flag or PINATA_JWT environment variable",
      );
      process.exit(1);
    }

    if (!fs.existsSync(options.dir)) {
      console.error(`✗ Error: Directory not found: ${options.dir}`);
      process.exit(1);
    }

    // Set environment variables that index.js will read
    process.env.INPUT_BUILD_LOCATION = options.dir;
    process.env.INPUT_PINATA_JWT = jwt;
    process.env.INPUT_PIN_ALIAS = options.alias || "";
    process.env.INPUT_CID_VERSION = options.cidVersion;
    process.env.INPUT_CLEANUP_OLD = options.cleanup ? "true" : "false";

    // Import and run the shared function
    const { pinDirectoryToPinata } = await import("./index.js");
    await pinDirectoryToPinata();
  });

// Update IPNS via Filebase command
program
  .command("update-ipns-filebase")
  .description("Update IPNS name to point to an IPFS hash via Filebase")
  .requiredOption("-n, --name <name>", "IPNS name to update")
  .requiredOption("-c, --cid <hash>", "IPFS CID/hash to point to")
  .option(
    "-k, --access-key <key>",
    "Filebase access key (or set FILEBASE_ACCESS_KEY env var)",
  )
  .option(
    "-s, --secret-key <key>",
    "Filebase secret key (or set FILEBASE_SECRET_KEY env var)",
  )
  .addHelpText(
    "after",
    `
Examples:
  $ ipfs-ops update-ipns-filebase --name my-site --cid QmHash... --access-key KEY --secret-key SECRET
  $ FILEBASE_ACCESS_KEY=key FILEBASE_SECRET_KEY=secret ipfs-ops update-ipns-filebase -n my-site -c QmHash
    `,
  )
  .action(async (options) => {
    const accessKey = options.accessKey || process.env.FILEBASE_ACCESS_KEY;
    const secretKey = options.secretKey || process.env.FILEBASE_SECRET_KEY;

    if (!accessKey || !secretKey) {
      console.error("✗ Error: Filebase credentials are required");
      console.error(
        "  Provide them via --access-key/--secret-key flags or FILEBASE_ACCESS_KEY/FILEBASE_SECRET_KEY env vars",
      );
      process.exit(1);
    }

    console.log(`Updating IPNS name: ${options.name}`);
    console.log(`Target CID: ${options.cid}`);

    const { updateIPNS } = await import("./index.js");
    const result = await updateIPNS(
      accessKey,
      secretKey,
      options.name,
      options.cid,
    );

    if (result) {
      console.log("✓ IPNS updated successfully!");
      console.log(`  IPNS ID: ${result}`);
      console.log(`  URL: https://ipfs.io/ipns/${result}`);
    } else {
      console.error("✗ Failed to update IPNS");
      process.exit(1);
    }
  });

program.parse();
