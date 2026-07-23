// Sprite-sheet drawing over AthenaEnv's crop API (startx/endx source rects,
// flips by swapping start/end) — same idiom as ps2-mario's
// SpriteSheetAnimation, generalized for the metadata in data/sheets.js.
//
// Destination size is expressed by mutating img.width/height before
// img.draw(x, y) — the only draw signature real AthenaEnv supports (the
// 5velte-ps2 shim reads the same properties). Natural texture size is
// captured at construction because width/height double as the dest size.

export class Sheet {
  constructor(meta) {
    this.meta = meta;
    this.img = new Image(meta.file);
    this.img.filter = NEAREST;
    this.cols = meta.cols || meta.count;
  }

  /**
   * Draw frame `i` centered at (cx, cy).
   * opts: scale (default 1), flipX, flipY, color (Athena color word), w/h
   * (explicit destination size, overrides scale).
   */
  draw(i, cx, cy, opts = {}) {
    const { fw, fh } = this.meta;
    const img = this.img;
    const scale = opts.scale === undefined ? 1 : opts.scale;
    const dw = opts.w === undefined ? fw * scale : opts.w;
    const dh = opts.h === undefined ? fh * scale : opts.h;

    const fx = (i % this.cols) * fw;
    const fy = Math.floor(i / this.cols) * fh;

    img.startx = opts.flipX ? fx + fw : fx;
    img.endx = opts.flipX ? fx : fx + fw;
    img.starty = opts.flipY ? fy + fh : fy;
    img.endy = opts.flipY ? fy : fy + fh;
    img.color = opts.color === undefined ? Color.new(255, 255, 255, 128) : opts.color;
    img.width = dw;
    img.height = dh;
    img.draw(cx - dw / 2, cy - dh / 2);
  }

  /** frame index for a looping animation clock (seconds) */
  frameAt(t, fps) {
    return Math.floor(t * fps) % this.meta.count;
  }
}

/** Whole-image drawing (backgrounds, logos, powerup icons). */
export class Pic {
  constructor(file) {
    this.img = new Image(file);
    this.img.filter = LINEAR;
    this.nw = this.img.width;
    this.nh = this.img.height;
  }

  /** top-left anchored, natural size unless w/h given */
  draw(x, y, opts = {}) {
    const img = this.img;
    img.startx = 0;
    img.starty = 0;
    img.endx = this.nw;
    img.endy = this.nh;
    img.color = opts.color === undefined ? Color.new(255, 255, 255, 128) : opts.color;
    img.width = opts.w === undefined ? this.nw : opts.w;
    img.height = opts.h === undefined ? this.nh : opts.h;
    img.draw(x, y);
  }

  /** centered at (cx, cy) with a uniform scale */
  center(cx, cy, opts = {}) {
    const scale = opts.scale === undefined ? 1 : opts.scale;
    const w = opts.w === undefined ? this.nw * scale : opts.w;
    const h = opts.h === undefined ? this.nh * scale : opts.h;
    this.draw(cx - w / 2, cy - h / 2, { w, h, color: opts.color });
  }
}
