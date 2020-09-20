// for vite : import.meta.env
interface ImportMeta {
  env: {[name: string]: string};
}

// added at runtime before any other code
interface Window {
  basepath?: string;
  relpath?: string;
}
