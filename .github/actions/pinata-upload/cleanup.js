import got from "got";
import * as core from "@actions/core";

const wait = (milliseconds) => {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const fetchPins = async (pinataJwt, nameFilter) => {
  try {
    core.info("Fetching pins to clean up...");
    let pinHashes = [];
    let pageOffset = 0;
    let hasMore = true;

    const PIN_QUERY = `https://api.pinata.cloud/data/pinList?status=pinned&pageLimit=1000&includeCount=false`;

    while (hasMore === true) {
      try {
        const url = nameFilter
          ? `${PIN_QUERY}&metadata[name]=${nameFilter}&pageOffset=${pageOffset}`
          : `${PIN_QUERY}&pageOffset=${pageOffset}`;

        const response = await got(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `Bearer ${pinataJwt}`,
          },
        });
        const responseData = JSON.parse(response.body);
        const rows = responseData.rows;

        if (rows.length === 0) {
          hasMore = false;
        }
        const itemsReturned = rows.length;
        pinHashes.push(...rows.map((row) => ({
          hash: row.ipfs_pin_hash,
          name: row.metadata?.name || 'unnamed'
        })));
        pageOffset += itemsReturned;
        await wait(300);
      } catch (error) {
        core.error(`Error fetching pins: ${error.message}`);
        break;
      }
    }
    core.info(`Total pins fetched: ${pinHashes.length}`);
    return pinHashes;
  } catch (error) {
    core.error(`Error in fetchPins: ${error.message}`);
    return [];
  }
};

const deletePins = async (pinataJwt, nameFilter) => {
  const pins = await fetchPins(pinataJwt, nameFilter);
  const totalPins = pins.length;

  if (totalPins === 0) {
    core.info("No pins found to delete");
    return 0;
  }

  let deletedPins = 0;
  try {
    for (const pin of pins) {
      try {
        core.info(`Deleting pin: ${pin.name} (${pin.hash})`);
        const response = await got(
          `https://api.pinata.cloud/pinning/unpin/${pin.hash}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${pinataJwt}`,
            },
          }
        );

        if (response.statusCode === 200) {
          deletedPins++;
          core.info(`Deleted ${deletedPins} of ${totalPins} pins`);
        } else {
          core.warning(`Failed to delete ${pin.hash}: ${response.statusMessage}`);
        }
        await wait(300);
      } catch (error) {
        core.error(`Error deleting pin ${pin.hash}: ${error.message}`);
      }
    }
    core.info(`Successfully deleted ${deletedPins} pins`);
    return deletedPins;
  } catch (error) {
    core.error(`Error in deletePins: ${error.message}`);
    return deletedPins;
  }
};

export { deletePins, fetchPins };
