import {writable} from 'svelte/store';
import type {Readable, Writable} from 'svelte/store';

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

export class BasicObjectStore<T extends Record<string, number | string>> implements Readable<T> {
  protected store: Writable<T>;
  protected __set: (newValue: T) => void;
  private value: T;
  private oldValue: T;
  constructor(initialValue?: T) {
    this.value = initialValue;
    this.oldValue = {...initialValue};
    this.store = writable(this.value, this._start.bind(this));
  }

  public get $store(): T {
    return this.value;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected _start(_: (newValue: T) => void): void {
    return this._stop.bind(this);
  }

  protected _stop(): void {}

  protected _set(newValue: T): void {
    let changes = false;
    if (!this.value) {
      this.value = {...newValue};
      changes = true;
    } else {
      for (const key of Object.keys(this.oldValue)) {
        if (newValue[key] !== this.oldValue[key]) {
          changes = true;
          (this.value as Record<string, unknown>)[key] = newValue[key];
        }
      }
      for (const key of Object.keys(newValue)) {
        if (newValue[key] !== this.oldValue[key]) {
          changes = true;
          (this.value as Record<string, unknown>)[key] = newValue[key];
        }
      }
    }

    if (changes) {
      this.oldValue = {...this.value};
      this.store.set(this.value);
    }
  }

  subscribe(run: (value: T) => void, invalidate?: (value?: T) => void): () => void {
    return this.store.subscribe(run, invalidate);
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
    if (!this.$store) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.$store as any) = {};
    }
    for (const key of Object.keys(obj)) {
      (this.$store as Record<string, unknown>)[key] = obj[key];
    }
    this.store.set(this.$store);
    return this.$store;
  }
  protected set(obj: T): T {
    if (!this.$store) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.$store as any) = {};
    }

    if (!obj) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.$store as any) = obj;
    }
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

export abstract class AutoStartBaseStore<T extends Record<string, unknown>> extends BaseStore<T> {
  private _listenerCount = 0;
  private _stopUpdates?: () => void;
  subscribe(run: (value: T) => void, invalidate?: (value?: T) => void): () => void {
    this._listenerCount++;
    if (this._listenerCount === 1) {
      console.info(`starting...`);
      this._stopUpdates = this._onStart();
    }
    const unsubscribe = this.store.subscribe(run, invalidate);
    return () => {
      this._listenerCount--;
      if (this._listenerCount === 0) {
        console.info(`stopping`);
        if (this._stopUpdates) {
          this._stopUpdates();
          this._stopUpdates = undefined;
        }
      }
      unsubscribe();
    };
  }

  abstract _onStart(): (() => void) | undefined;
}
