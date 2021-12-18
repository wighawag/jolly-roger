type Color = string;

export class Blockie {
  imageData: number[]; // TODO Uint8Array ?
  color: Color;
  bgcolor: Color;
  spotcolor: Color;
  scale: number;
  size: number;

  private randseed: number[] = [0, 0, 0, 0];

  static blockiesCache: {[key: string]: Blockie} = {};
  static blockieStringsCache: {[key: string]: string} = {};
  static get(address: string, offset = 0): Blockie {
    const key = address.toLowerCase() + '_' + offset;
    if (!Blockie.blockiesCache[key]) {
      Blockie.blockiesCache[key] = new Blockie(address, 1);
    }
    return Blockie.blockiesCache[key];
  }

  static getURI(address: string, offset = 0): string {
    if (typeof document === 'undefined') {
      return '';
    }
    const key = address.toLowerCase() + '_' + offset;
    if (!Blockie.blockieStringsCache[key]) {
      const blockie = Blockie.get(address);
      const canvas = document.createElement('canvas');
      canvas.width = 8 + offset * 2;
      canvas.height = 8 + offset * 2;
      const ctx = canvas.getContext('2d');
      blockie.draw(ctx, 0, 0, 1, {offset});
      Blockie.blockieStringsCache[key] = canvas.toDataURL();
    }
    return Blockie.blockieStringsCache[key];
  }

  private constructor(address: string, scale = 4) {
    this.scale = scale;
    this.size = 8;

    this.seedrand(address);

    this.color = this.createColor();
    this.bgcolor = this.createColor();
    this.spotcolor = this.createColor();
    this.imageData = this.createImageData(this.size);
  }

  //TODO Image Texture
  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    furtherScale: number,
    options?: {offset?: number; border?: number}
  ): void {
    const oldColor = ctx.fillStyle;
    const appliedScale = this.scale * furtherScale;
    const appliedSize = this.size * appliedScale;
    // switch(halign){
    // 	case Left:
    // 	case Center: x -= appliedSize/2;
    // 	case Right: x -= appliedSize;
    // }
    // switch(valign){
    // 	case Top:
    // 	case Center: y-= appliedSize/2;
    // 	case Bottom: y-= appliedSize;
    // }
    if (options?.border === 1) {
      ctx.strokeStyle = 'green';
      ctx.lineWidth = appliedScale;
      ctx.setLineDash([]);
      ctx.strokeRect(
        Math.floor(x - appliedScale),
        Math.floor(y - appliedScale),
        Math.floor(appliedSize + appliedScale * 2),
        Math.floor(appliedSize + appliedScale * 2)
      );
    }
    // else if (border === 2) {
    //   ctx.strokeStyle = 'red';
    //   ctx.lineWidth = appliedScale / 4;
    //   ctx.setLineDash([]);
    //   ctx.strokeRect(
    //     Math.floor(x - appliedScale),
    //     Math.floor(y - appliedScale),
    //     Math.floor(appliedSize + appliedScale * 2),
    //     Math.floor(appliedSize + appliedScale * 2)
    //   );
    // }

    ctx.fillStyle = this.bgcolor;

    if (options?.offset) {
      ctx.fillRect(
        Math.floor(x),
        Math.floor(y),
        Math.floor(appliedSize + options.offset * 2),
        Math.floor(appliedSize + options.offset * 2)
      );
      x += options.offset;
      y += options.offset;
    } else {
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(appliedSize), Math.floor(appliedSize));
    }
    for (let i = 0; i < this.imageData.length; i++) {
      const row = Math.floor(i / this.size);
      const col = i % this.size;
      // if data is 2, choose spot color, if 1 choose foreground
      ctx.fillStyle = this.imageData[i] == 1 ? this.color : this.spotcolor;
      // if data is 0, leave the background
      if (this.imageData[i] != 0) {
        ctx.fillRect(
          Math.floor(x + col * appliedScale),
          Math.floor(y + row * appliedScale),
          Math.ceil(appliedScale),
          Math.ceil(appliedScale)
        );
      }
    }
    ctx.fillStyle = oldColor;
  }

  seedrand(seed: string): void {
    for (let i = 0; i < this.randseed.length; i++) {
      this.randseed[i] = 0;
    }
    for (let i = 0; i < seed.length; i++) {
      this.randseed[i % 4] = (this.randseed[i % 4] << 5) - this.randseed[i % 4] + seed.charCodeAt(i);
    }
  }

  rand(): number {
    // based on Java's String.hashCode(), expanded to 4 32bit values
    const t = this.randseed[0] ^ (this.randseed[0] << 11);

    this.randseed[0] = this.randseed[1];
    this.randseed[1] = this.randseed[2];
    this.randseed[2] = this.randseed[3];
    this.randseed[3] = this.randseed[3] ^ (this.randseed[3] >> 19) ^ t ^ (t >> 8);

    return (this.randseed[3] >>> 0) / ((1 << 31) >>> 0);
  }

  createColor(): Color {
    // saturation is the whole color spectrum
    const h = Math.floor(this.rand() * 360);
    // saturation goes from 40 to 100, it avoids greyish colors
    const s = Math.floor(1000 * (this.rand() * 60 + 40)) / 1000 + '%';
    // lightness can be anything from 0 to 100, but probabilities are a bell curve around 50%
    const l = Math.floor(1000 * (this.rand() + this.rand() + this.rand() + this.rand()) * 25) / 1000 + '%';

    const color = 'hsl(' + h + ',' + s + ',' + l + ')';
    return color;
  }

  hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  createImageData(size: number): number[] {
    const width = size; // Only support square icons for now
    const height = size;

    const dataWidth = Math.ceil(width / 2);
    const mirrorWidth = width - dataWidth;

    const data = [];
    for (let y = 0; y < height; y++) {
      let row = [];
      for (let x = 0; x < dataWidth; x++) {
        // this makes foreground and background color to have a 43% (1/2.3) probability
        // spot color has 13% chance
        row[x] = Math.floor(this.rand() * 2.3);
      }
      const r = row.slice(0, mirrorWidth);
      r.reverse();
      row = row.concat(r);

      for (let i = 0; i < row.length; i++) {
        data.push(row[i]);
      }
    }

    return data;
  }
}
