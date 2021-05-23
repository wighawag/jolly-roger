export const initialState: {
  fetching: boolean;
  stale: boolean;
  error: unknown;
  data?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
} = {
  fetching: false,
  stale: false,
  error: undefined,
  data: undefined,
  extensions: undefined,
};
