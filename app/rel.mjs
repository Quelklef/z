export class BinRel {
  constructor(pairs = []) {
    this.ltr = new Map();
    this.rtl = new Map();

    for (const [l, r] of pairs)
      this.add(l, r);
  }

  add(l, r) {
    if (!this.ltr.has(l)) this.ltr.set(l, new Set());
    this.ltr.get(l).add(r);
    if (!this.rtl.has(r)) this.rtl.set(r, new Set());
    this.rtl.get(r).add(l);
  }

  rtlGet(r) {
    return (this.rtl.get(r) || new Set());
  }

  ltrGet(l) {
    return (this.ltr.get(l) || new Set());
  }
}
