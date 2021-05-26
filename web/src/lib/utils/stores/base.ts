import {Writable, writable, Readable} from 'svelte/store';

type DataType<T> = Record<string, unknown> & {data?: T};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
function _recurseSet(target: any, obj: any) {
  for (const key of Object.keys(obj)) {
    if (target[key] && typeof target[key] === 'object' && typeof obj[key] === 'object') {
      _recurseSet(target[key], obj[key]);
    } else {
      target[key] = obj[key];
    }
  }
}

export class BaseStore<T extends Record<string, unknown>> implements Readable<T> {
  protected store: Writable<T>;
  constructor(protected readonly $store: T) {
    this.store = writable(this.$store);
  }

  subscribe(run: (value: T) => void, invalidate?: (value?: T) => void): () => void {
    return this.store.subscribe(run, invalidate);
  }

  protected setPartial(obj: Partial<T>): T {
    for (const key of Object.keys(obj)) {
      (this.$store as Record<string, unknown>)[key] = obj[key];
    }
    this.store.set(this.$store);
    return this.$store;
  }
  protected set(obj: T): T {
    // Testing hmr for subclasses
    //   const objAny: any = obj;
    //   objAny.value += 7;
    if (obj !== this.$store) {
      for (const key of Object.keys(this.$store)) {
        if (obj[key] === undefined) {
          (this.$store as Record<string, unknown>)[key] = undefined;
        }
      }
      for (const key of Object.keys(obj)) {
        (this.$store as Record<string, unknown>)[key] = obj[key];
      }
    }
    this.store.set(this.$store);
    return this.$store;
  }
}

export class BaseStoreWithData<T extends DataType<U>, U> extends BaseStore<T> {
  constructor($store: T) {
    super($store);
  }

  protected setData(data: Partial<U>, extra?: Partial<T>): T {
    this.$store.data = this.$store.data || ({} as U); // this assume setData was set before ?
    _recurseSet(this.$store.data, data);
    if (extra) {
      this.setPartial(extra);
    }
    this.store.set(this.$store);
    return this.$store;
  }
}
