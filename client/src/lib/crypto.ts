/**
 * End-to-end encryption for the file data itself.
 *
 * The transport (WebRTC DataChannel or the WebSocket relay fallback) is
 * already encrypted in transit, but this layer exists so the guarantee
 * doesn't depend on transport choice, on the relay operator's honesty,
 * or on us getting the transport layer right: even a full server
 * compromise exposes only ciphertext, because the key never touches the
 * server.
 *
 * Design, in one paragraph: both browsers generate an ephemeral ECDH
 * keypair and exchange public keys through the signaling relay. Each
 * derives the same shared secret via ECDH, then HKDF-expands it into two
 * *directional* AES-256-GCM keys (initiator→responder and
 * responder→initiator) so the two possible senders never share a
 * nonce space. A short numeric code derived from both public keys is
 * shown on both screens so two cautious people can read it to each other
 * and rule out a man-in-the-middle server — see docs/SECURITY.md.
 */

const ECDH_PARAMS: EcKeyAlgorithm = { name: 'ECDH', namedCurve: 'P-256' } as EcKeyAlgorithm;
const HKDF_HASH = 'SHA-256';
const INFO_I2R = 'pear-to-pear-v1:initiator-to-responder';
const INFO_R2I = 'pear-to-pear-v1:responder-to-initiator';
const INFO_SAS = 'pear-to-pear-v1:verification-code';
const NONCE_BYTES = 12;

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveBits']);
  return pair as KeyPair;
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

export async function importPeerPublicKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToBuffer(base64);
  return crypto.subtle.importKey('raw', raw, ECDH_PARAMS, true, []);
}

/**
 * A ready-to-use encrypt/decrypt pair for one bonded session. Create one
 * of these once both public keys are known; it holds the directional
 * keys and the sender-side nonce counter.
 */
export class SecureChannel {
  private sendKey: CryptoKey | null = null;
  private recvKey: CryptoKey | null = null;
  private sendCounter = 0n;
  readonly verificationCode: Promise<string>;

  private constructor(
    private readonly sharedBitsPromise: Promise<ArrayBuffer>,
    private readonly saltPromise: Promise<ArrayBuffer>,
    private readonly role: 'initiator' | 'responder',
  ) {
    this.verificationCode = this.deriveVerificationCode();
  }

  static async establish(
    myKeys: KeyPair,
    peerPublicKeyB64: string,
    role: 'initiator' | 'responder',
  ): Promise<SecureChannel> {
    const peerPublicKey = await importPeerPublicKey(peerPublicKeyB64);
    const myPublicRaw = await crypto.subtle.exportKey('raw', myKeys.publicKey);
    const peerRaw = base64ToBuffer(peerPublicKeyB64);

    const sharedBits = crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerPublicKey } as EcdhKeyDeriveParams,
      myKeys.privateKey,
      256,
    );
    const salt = sortedConcatDigest(myPublicRaw, peerRaw);

    return new SecureChannel(sharedBits, salt, role);
  }

  private async hkdfKey(): Promise<CryptoKey> {
    const bits = await this.sharedBitsPromise;
    return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey', 'deriveBits']);
  }

  private async deriveDirectionalKey(info: string): Promise<CryptoKey> {
    const hkdfKey = await this.hkdfKey();
    const salt = await this.saltPromise;
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: HKDF_HASH, salt, info: new TextEncoder().encode(info) },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private async deriveVerificationCode(): Promise<string> {
    const hkdfKey = await this.hkdfKey();
    const salt = await this.saltPromise;
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: HKDF_HASH,
        salt,
        info: new TextEncoder().encode(INFO_SAS),
      } as HkdfParams,
      hkdfKey,
      24,
    );
    const n = new DataView(bits).getUint32(0) & 0xffffff;
    return String(n % 1_000_000).padStart(6, '0');
  }

  private async ensureKeys(): Promise<void> {
    if (this.sendKey && this.recvKey) return;
    const [i2r, r2i] = await Promise.all([
      this.deriveDirectionalKey(INFO_I2R),
      this.deriveDirectionalKey(INFO_R2I),
    ]);
    this.sendKey = this.role === 'initiator' ? i2r : r2i;
    this.recvKey = this.role === 'initiator' ? r2i : i2r;
  }

  /** Encrypts one chunk, returning nonce(12) || ciphertext || tag(16). */
  async encrypt(plaintext: ArrayBuffer): Promise<ArrayBuffer> {
    await this.ensureKeys();
    const nonce = this.nextNonce();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      this.sendKey!,
      plaintext,
    );
    const out = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
    out.set(nonce, 0);
    out.set(new Uint8Array(ciphertext), NONCE_BYTES);
    return out.buffer;
  }

  /** Decrypts a nonce(12) || ciphertext || tag(16) frame. Throws on tamper. */
  async decrypt(frame: ArrayBuffer): Promise<ArrayBuffer> {
    await this.ensureKeys();
    const nonce = frame.slice(0, NONCE_BYTES);
    const ciphertext = frame.slice(NONCE_BYTES);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, this.recvKey!, ciphertext);
  }

  private nextNonce(): Uint8Array {
    const nonce = new Uint8Array(NONCE_BYTES);
    const view = new DataView(nonce.buffer);
    // First 4 bytes stay zero; last 8 are a monotonic counter. Unique for
    // the lifetime of sendKey, which is unique per bonded session.
    view.setBigUint64(4, this.sendCounter, false);
    this.sendCounter += 1n;
    return nonce;
  }
}

async function sortedConcatDigest(a: ArrayBuffer, b: ArrayBuffer): Promise<ArrayBuffer> {
  const [first, second] = compareBuffers(a, b) <= 0 ? [a, b] : [b, a];
  const combined = new Uint8Array(first.byteLength + second.byteLength);
  combined.set(new Uint8Array(first), 0);
  combined.set(new Uint8Array(second), first.byteLength);
  return crypto.subtle.digest('SHA-256', combined);
}

function compareBuffers(a: ArrayBuffer, b: ArrayBuffer): number {
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  const len = Math.min(ua.length, ub.length);
  for (let i = 0; i < len; i++) {
    if (ua[i] !== ub[i]) return ua[i] - ub[i];
  }
  return ua.length - ub.length;
}

function bufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
