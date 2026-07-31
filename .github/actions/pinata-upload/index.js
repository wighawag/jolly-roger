import fs from "fs";
import path from "path";
import FormData from "form-data";
import rfs from "recursive-fs";
import basePathConverter from "base-path-converter";
import got from "got";
import * as core from "@actions/core";
import { deletePins } from "./cleanup.js";

const updateIPNS = async (
  filebaseAccessKey,
  filebaseSecretKey,
  ipnsName,
  ipfsHash,
) => {
  try {
    core.info(`Updating IPNS name ${ipnsName} to point to ${ipfsHash}`);

    // Filebase requires Base64-encoded "ACCESS-KEY:SECRET-KEY" as Bearer token
    const credentials = `${filebaseAccessKey}:${filebaseSecretKey}`;
    const encodedToken = Buffer.from(credentials).toString("base64");

    // Use Filebase IPNS API to publish/update the name
    // PUT /v1/names/:name
    await got.put(
      `https://api.filebase.io/v1/names/${ipnsName}`,
      {
        headers: {
          Authorization: `Bearer ${encodedToken}`,
          "Content-Type": "application/json",
        },
        json: {
          label: ipnsName,
          cid: ipfsHash,
        },
      },
    );

    core.info(`IPNS published successfully`);

    // Fetch the IPNS name details to get the network_key
    // GET /v1/names/:label
    const getResponse = await got.get(
      `https://api.filebase.io/v1/names/${ipnsName}`,
      {
        headers: {
          Authorization: `Bearer ${encodedToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const nameDetails = JSON.parse(getResponse.body);
    const networkKey = nameDetails.network_key;

    if (!networkKey) {
      core.warning(`No network_key found in response`);
      return null;
    }

    core.info(`IPNS Network Key: ${networkKey}`);

    // Return the network key (k51...)
    return networkKey;
  } catch (error) {
    core.warning(`Failed to update IPNS: ${error.message}`);
    if (error.response) {
      core.warning(`Response status: ${error.response.statusCode}`);
      core.warning(`Response body: ${error.response.body}`);
    }
    return null;
  }
};

const postPRComment = async (token, ipfsHash, ipnsKey) => {
  try {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    const prNumber = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
    ).pull_request.number;

    const ipfsIoUrl = `https://ipfs.io/ipfs/${ipfsHash}`;
    const pinataUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

    // Hidden marker used to find and update this action's own comment,
    // independent of the human-facing title.
    const COMMENT_MARKER = "<!-- ipfs-deployment-comment -->";
    const projectName = repo;

    let commentBody = `${COMMENT_MARKER}
## 🌐 IPFS Deployment: ${projectName}

Your site has been deployed to IPFS!

**IPFS Hash:** \`${ipfsHash}\`

**Preview URLs:**
- 🔗 [ipfs.io](${ipfsIoUrl})
- 📌 [Pinata Gateway](${pinataUrl})`;

    if (ipnsKey) {
      commentBody += `\n- 🔗 [IPNS (stable URL)](https://ipfs.io/ipns/${ipnsKey})`;
    }

    commentBody += `\n\n_This preview will be updated on every push to this PR._`;

    // List existing comments
    const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
    const commentsResponse = await got(commentsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    const comments = JSON.parse(commentsResponse.body);
    const existingComment = comments.find(
      (comment) =>
        comment.user.type === "Bot" &&
        comment.body.includes(COMMENT_MARKER),
    );

    if (existingComment) {
      // Update existing comment
      core.info("Updating existing PR comment");
      await got.patch(
        `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existingComment.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
          json: { body: commentBody },
        },
      );
    } else {
      // Create new comment
      core.info("Creating new PR comment");
      await got.post(commentsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        json: { body: commentBody },
      });
    }
  } catch (error) {
    core.warning(`Failed to post PR comment: ${error.message}`);
  }
};

const pinDirectoryToPinata = async () => {
  const url = `https://api.pinata.cloud/pinning/pinFileToIPFS`;
  let src = process.env.INPUT_BUILD_LOCATION || core.getInput("build-location");
  const pinataJwt = process.env.INPUT_PINATA_JWT || core.getInput("pinata-jwt");
  const pinAlias = process.env.INPUT_PIN_ALIAS || core.getInput("pin-alias");
  const cidVersion =
    process.env.INPUT_CID_VERSION || core.getInput("cid-version") || "1";
  const cleanupOld =
    (process.env.INPUT_CLEANUP_OLD || core.getInput("cleanup-old")) === "true";
  const githubToken =
    process.env.INPUT_GITHUB_TOKEN || core.getInput("github-token");
  const ipnsName = process.env.INPUT_IPNS_NAME || core.getInput("ipns-name");
  const filebaseAccessKey =
    process.env.INPUT_FILEBASE_ACCESS_KEY ||
    core.getInput("filebase-access-key");
  const filebaseSecretKey =
    process.env.INPUT_FILEBASE_SECRET_KEY ||
    core.getInput("filebase-secret-key");

  // Resolve path relative to workspace root (GITHUB_WORKSPACE) if in GitHub Actions
  if (process.env.GITHUB_WORKSPACE && !path.isAbsolute(src)) {
    src = path.join(process.env.GITHUB_WORKSPACE, src);
  }

  try {
    // Clean up old pins with the same alias before uploading new version
    if (cleanupOld && pinAlias) {
      core.info(`Cleaning up old pins with alias: ${pinAlias}`);
      const deletedCount = await deletePins(pinataJwt, pinAlias);
      core.info(`Cleaned up ${deletedCount} old pins`);
    }
    core.info(`Reading directory: ${src}`);
    const { dirs, files } = await rfs.read(src);

    let data = new FormData();

    core.info(`Adding ${files.length} files to form data`);
    for (const file of files) {
      data.append(`file`, fs.createReadStream(file), {
        filepath: basePathConverter(src, file),
      });
    }

    // Add pinata options
    const pinataOptions = {
      cidVersion: parseInt(cidVersion),
    };

    if (pinAlias) {
      pinataOptions.customPinPolicy = {
        regions: [
          {
            id: "FRA1",
            desiredReplicationCount: 1,
          },
        ],
      };
    }

    data.append("pinataOptions", JSON.stringify(pinataOptions));

    if (pinAlias) {
      const pinataMetadata = {
        name: pinAlias,
      };
      data.append("pinataMetadata", JSON.stringify(pinataMetadata));
    }

    core.info("Uploading to Pinata...");

    let uploadProgress = 0;
    const response = await got(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pinataJwt}`,
      },
      body: data,
    }).on("uploadProgress", (progress) => {
      const percent = Math.round((progress.transferred / progress.total) * 100);
      const wasChanged = uploadProgress !== percent;
      uploadProgress = percent;
      if (wasChanged && uploadProgress % 5 === 0) {
        core.info(`Upload progress: ${percent}%`);
      }
    });

    const result = JSON.parse(response.body);
    core.info(`Successfully pinned to IPFS!`);
    core.info(`IPFS Hash: ${result.IpfsHash}`);
    core.info(`Pin Size: ${result.PinSize}`);
    core.info(`Timestamp: ${result.Timestamp}`);

    // Set outputs
    core.setOutput("ipfs-hash", result.IpfsHash);
    core.setOutput("pin-size", result.PinSize);
    core.setOutput("timestamp", result.Timestamp);
    core.setOutput(
      "ipfs-url",
      `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
    );
    core.setOutput("ipfs-io-url", `https://ipfs.io/ipfs/${result.IpfsHash}`);

    // Update IPNS if name and Filebase credentials are provided
    let updatedIpnsId = null;
    if (ipnsName && filebaseAccessKey && filebaseSecretKey) {
      updatedIpnsId = await updateIPNS(
        filebaseAccessKey,
        filebaseSecretKey,
        ipnsName,
        result.IpfsHash,
      );
      if (updatedIpnsId) {
        core.setOutput("ipns-id", updatedIpnsId);
        core.setOutput("ipns-name", ipnsName);
        core.setOutput("ipns-url", `https://ipfs.io/ipns/${updatedIpnsId}`);
      }
    }

    // Post PR comment if GitHub token is provided and this is a PR
    if (githubToken && process.env.GITHUB_EVENT_NAME === "pull_request") {
      await postPRComment(githubToken, result.IpfsHash, updatedIpnsId);
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error.message}`);
    if (error.response) {
      core.error(`Response status: ${error.response.statusCode}`);
      core.error(`Response body: ${error.response.body}`);
    }
  }
};

// Export for CLI usage
export { updateIPNS, pinDirectoryToPinata };

// Run if called directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  pinDirectoryToPinata();
}
