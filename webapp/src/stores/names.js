import { writable } from "svelte/store";
import { client, NAMES, NAMES_SUBSCRIPTION } from "../graphql";

function wait(t, v) {
  return new Promise(function(resolve) {
    setTimeout(resolve.bind(null, v), t * 1000);
  });
}

const $data = {};
const { subscribe, set } = writable($data);

function _set(data) {
  Object.assign($data, data);
  set($data);
}

async function listen() {
  if (!process.browser) {
    return;
  }
  if ($data.listenning) {
    return;
  }
  _set({ listenning: true });

  if ($data.status !== "loaded") {
    _set({ status: "loading" });
  }

  // TODO handle error

  let sub = await client.subscribe({
    query: NAMES_SUBSCRIPTION
  });
  // let sub = await client.watchQuery({
  //     query: NAMES,
  //     pollInterval : 1000
  // });

  sub.subscribe({
    next: result => _set({ status: "loaded", data: result.data.namedEntities.map(item => item.name) }),
    error: (...args) => console.log("error", ...args),
    complete: (...args) => console.log("complete", ...args)
  });
}

let dataStore;
export default dataStore = {
  subscribe,
  load: async () => {
    if ($data.status !== "loaded") {
      _set({ status: "loading" });
    }
    const result = await client.query({
      query: NAMES,
      fetchPolicy: process.browser ? undefined : "network-only"
    });
    console.log({ result: JSON.stringify(result, null, "  ") });
    _set({ status: "loaded", data: result.data.namedEntities.map(item => item.name) });
    return { data: result.data };
  },
  boot: data => {
    if (data) {
      client.writeQuery({ query: NAMES, data });
      _set({ status: "loaded", data: data.namedEntities.map(item => item.name) });
    }
    listen();
  },
  listen
};

if (typeof window !== "undefined") {
  window.names = $data;
}
