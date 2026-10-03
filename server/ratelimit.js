/**
 * Einfaches Token-Bucket-Rate-Limiting (pro Socket bzw. pro IP).
 */
export class TokenBucket {
  /**
   * @param {number} capacity  maximale Anzahl Aktionen am Stück
   * @param {number} perSecond Nachfüllrate
   */
  constructor(capacity, perSecond) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.tokens = capacity;
    this.last = Date.now();
  }

  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** Begrenzung pro Schlüssel (z. B. IP) mit automatischem Aufräumen */
export class KeyedLimiter {
  constructor(capacity, perSecond) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.buckets = new Map();
    this.timer = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.timer.unref?.();
  }

  take(key, n = 1) {
    let b = this.buckets.get(key);
    if (!b) {
      b = new TokenBucket(this.capacity, this.perSecond);
      this.buckets.set(key, b);
    }
    return b.take(n);
  }

  sweep() {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now - b.last > 10 * 60 * 1000) this.buckets.delete(k);
  }
}
