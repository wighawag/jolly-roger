import {blockTime} from '$lib/config';
import type {Provider} from '@ethersproject/abstract-provider';
import {logs} from 'named-logs';
import type {Readable} from 'svelte/store';
const console = logs('chainTempo');

function removeFrom(array: unknown[], elem: unknown): void {
  for (let i = array.length - 1; i >= 0; i--) {
    if (array[i] === elem) {
      array.splice(i, 1);
      return;
    }
  }
  console.log('NOT FOUND');
}

export type ChainTempoInfo = {lastBlockNumber?: number; stale: boolean};

export type TempoListener = (chainInfo: ChainTempoInfo) => void;

class ChainTempo implements Readable<ChainTempoInfo> {
  private blockListeners: TempoListener[] = [];
  private currentProvider?: Provider = undefined;
  private callback: () => void;
  private timeout: NodeJS.Timeout;
  private lastUpdate = 0;
  private triggerTimeout: NodeJS.Timeout;
  public readonly chainInfo: ChainTempoInfo = {lastBlockNumber: undefined, stale: true};

  constructor(private maxTimeout: number) {}

  subscribe(func: TempoListener): () => void {
    func(this.chainInfo);
    this.blockListeners.push(func);
    return removeFrom.bind(null, this.blockListeners, func);
  }

  check() {
    const now = Date.now() / 1000;
    if (now - this.lastUpdate > this.maxTimeout - 1) {
      console.info(`timed out... ${now}  - ${this.lastUpdate} = ${now - this.lastUpdate} > ${this.maxTimeout - 1}`);
      this.onBlock(undefined);
    }
    this.timeout = setTimeout(this.check.bind(this), this.maxTimeout * 1000);
  }

  startOrUpdateProvider(provider?: Provider) {
    if (this.currentProvider !== provider) {
      if (this.currentProvider) {
        console.info('stop listening for block event');
        this.currentProvider.off('block', this.callback);
      }
      this.callback = this.onBlock.bind(this);
      this.currentProvider = provider;
      if (this.currentProvider) {
        console.info('listening for block event');
        this.currentProvider.on('block', this.callback);
      }
    }

    // fallback on time as provider might not be available
    if (!this.timeout) {
      this.timeout = setTimeout(this.check.bind(this), this.maxTimeout * 1000);
    }
  }
  private onBlock(blockNumber?: number) {
    if (blockNumber) {
      this.chainInfo.lastBlockNumber = blockNumber;
      this.chainInfo.stale = false;
    } else {
      this.chainInfo.stale = true;
    }
    this.lastUpdate = Date.now() / 1000;
    this.triggerListeners();
  }

  private triggerListeners() {
    if (this.triggerTimeout) {
      clearTimeout(this.triggerTimeout);
    }
    this.triggerTimeout = setTimeout(this.callListeners.bind(this), 0);
  }

  private callListeners() {
    console.info(`onBlock ${this.chainInfo.lastBlockNumber}`);

    for (const listener of this.blockListeners) {
      // TODO delay them ?
      listener(this.chainInfo); // TODO wait for each one ?
    }
    // TODO wait for them (if delayed) before triggering the next update?
  }
}

export const chainTempo = new ChainTempo(blockTime * 6);
