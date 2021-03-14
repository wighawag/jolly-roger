<script lang="ts">
  // blockie generation code from https://github.com/stephensprinkle/react-blockies, itself referenced from https://github.com/alexvandesande/blockies
  import {afterUpdate} from 'svelte';

  export let _class = '';
  export {_class as class};
  export let address: string;
  export let scale: number = 4;

  let lastOptions:
    | {
        address: string;
        scale: number;
      }
    | undefined = undefined;

  let canvas: HTMLCanvasElement;

  // The random number is a js implementation of the Xorshift PRNG
  const randseed = new Array(4); // Xorshift: [x, y, z, w] 32 bit values

  function seedrand(seed: string): void {
    for (let i = 0; i < randseed.length; i++) {
      randseed[i] = 0;
    }
    for (let i = 0; i < seed.length; i++) {
      randseed[i % 4] =
        (randseed[i % 4] << 5) - randseed[i % 4] + seed.charCodeAt(i);
    }
  }

  function rand(): number {
    // based on Java's String.hashCode(), expanded to 4 32bit values
    const t = randseed[0] ^ (randseed[0] << 11);

    randseed[0] = randseed[1];
    randseed[1] = randseed[2];
    randseed[2] = randseed[3];
    randseed[3] = randseed[3] ^ (randseed[3] >> 19) ^ t ^ (t >> 8);

    return (randseed[3] >>> 0) / ((1 << 31) >>> 0);
  }

  function createColor(): string {
    // saturation is the whole color spectrum
    const h = Math.floor(rand() * 360);
    // saturation goes from 40 to 100, it avoids greyish colors
    const s = rand() * 60 + 40 + '%';
    // lightness can be anything from 0 to 100, but probabilities are a bell curve around 50%
    const l = (rand() + rand() + rand() + rand()) * 25 + '%';

    const color = 'hsl(' + h + ',' + s + ',' + l + ')';
    return color;
  }

  function createImageData(size: number): number[] {
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
        row[x] = Math.floor(rand() * 2.3);
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

  function setCanvas(
    canvas: HTMLCanvasElement,
    imageData: number[],
    color: string,
    scale: number,
    bgcolor: string,
    spotcolor: string
  ) {
    const width = Math.sqrt(imageData.length);
    const size = width * scale;

    canvas.width = size;
    canvas.height = size;

    const cc = canvas.getContext('2d');
    if (cc) {
      cc.fillStyle = bgcolor;
      cc.fillRect(0, 0, canvas.width, canvas.height);
      cc.fillStyle = color;

      for (let i = 0; i < imageData.length; i++) {
        // if data is 2, choose spot color, if 1 choose foreground
        cc.fillStyle = imageData[i] === 1 ? color : spotcolor;

        // if data is 0, leave the background
        if (imageData[i]) {
          const row = Math.floor(i / width);
          const col = i % width;

          cc.fillRect(col * scale, row * scale, scale, scale);
        }
      }
    } else {
      console.error(`could not create 2d context for Blockie canvas`);
    }
  }

  function update() {
    if (
      lastOptions &&
      lastOptions.address === address &&
      lastOptions.scale === scale
    ) {
      return;
    }
    lastOptions = {
      address,
      scale,
    };

    seedrand(
      (address && address.toLowerCase()) ||
        '0x0000000000000000000000000000000000000000'
    );
    const color = createColor();
    const bgcolor = createColor();
    const spotcolor = createColor();
    const imageData = createImageData(8);
    setCanvas(canvas, imageData, color, scale, bgcolor, spotcolor);
  }

  afterUpdate(update);
</script>

<style>
  canvas {
    image-rendering: -moz-crisp-edges;
    image-rendering: -webkit-crisp-edges;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }
</style>

<canvas class={_class} bind:this={canvas} />
