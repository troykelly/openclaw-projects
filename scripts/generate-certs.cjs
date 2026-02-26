#!/usr/bin/env node
/**
 * Certificate generation script for mTLS between API server and tmux worker.
 *
 * Generates:
 * - CA certificate and key
 * - API server client certificate (signed by CA)
 * - TMux worker server certificate (signed by CA)
 *
 * Uses pure Node.js crypto module — no openssl CLI dependency.
 * This allows running on node:22-slim without installing system packages.
 *
 * Output directory defaults to /certs, configurable via CERT_OUTPUT_DIR env var.
 *
 * Issue #1685 — mTLS between API server and tmux worker
 * Issue #1856 — Fix mTLS cert generation (node:crypto rewrite)
 * Epic #1667 — TMux Session Management
 */

'use strict';

const { generateKeyPairSync, createSign, createHash, randomBytes, X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_DIR = process.env.CERT_OUTPUT_DIR || '/certs';
const CA_DAYS = parseInt(process.env.CA_CERT_DAYS || '3650', 10);
const CERT_DAYS = parseInt(process.env.CERT_DAYS || '365', 10);

/**
 * Encode a DER length in ASN.1 format.
 */
function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x100) return Buffer.from([0x81, length]);
  if (length < 0x10000) return Buffer.from([0x82, (length >> 8) & 0xff, length & 0xff]);
  throw new Error(`DER length too large: ${length}`);
}

/**
 * Wrap content in an ASN.1 SEQUENCE.
 */
function derSequence(buffers) {
  const content = Buffer.concat(buffers);
  return Buffer.concat([Buffer.from([0x30]), derLength(content.length), content]);
}

/**
 * Wrap content in an ASN.1 SET.
 */
function derSet(buffers) {
  const content = Buffer.concat(buffers);
  return Buffer.concat([Buffer.from([0x31]), derLength(content.length), content]);
}

/**
 * Encode an ASN.1 OID from a dot-notation string.
 */
function derOid(oid) {
  const parts = oid.split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val >= 0x80) {
      const encoded = [];
      encoded.push(val & 0x7f);
      val >>= 7;
      while (val > 0) {
        encoded.push((val & 0x7f) | 0x80);
        val >>= 7;
      }
      bytes.push(...encoded.reverse());
    } else {
      bytes.push(val);
    }
  }
  const buf = Buffer.from(bytes);
  return Buffer.concat([Buffer.from([0x06]), derLength(buf.length), buf]);
}

/**
 * Encode an ASN.1 UTF8String.
 */
function derUtf8String(str) {
  const buf = Buffer.from(str, 'utf-8');
  return Buffer.concat([Buffer.from([0x0c]), derLength(buf.length), buf]);
}

/**
 * Encode an ASN.1 PrintableString.
 */
function derPrintableString(str) {
  const buf = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([0x13]), derLength(buf.length), buf]);
}

/**
 * Encode an ASN.1 INTEGER.
 */
function derInteger(buf) {
  // Ensure positive (add leading 0 if high bit set)
  if (buf[0] & 0x80) {
    buf = Buffer.concat([Buffer.from([0x00]), buf]);
  }
  return Buffer.concat([Buffer.from([0x02]), derLength(buf.length), buf]);
}

/**
 * Encode an ASN.1 BIT STRING.
 */
function derBitString(buf) {
  // Prepend 0 unused bits byte
  const content = Buffer.concat([Buffer.from([0x00]), buf]);
  return Buffer.concat([Buffer.from([0x03]), derLength(content.length), content]);
}

/**
 * Encode an ASN.1 OCTET STRING.
 */
function derOctetString(buf) {
  return Buffer.concat([Buffer.from([0x04]), derLength(buf.length), buf]);
}

/**
 * Encode an ASN.1 explicit context tag.
 */
function derContext(tag, buf) {
  return Buffer.concat([Buffer.from([0xa0 | tag]), derLength(buf.length), buf]);
}

/**
 * Encode an ASN.1 GeneralizedTime.
 */
function derGeneralizedTime(date) {
  const str = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  const buf = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([0x18]), derLength(buf.length), buf]);
}

/**
 * Encode a Distinguished Name.
 */
function derName(attrs) {
  const rdnSequence = attrs.map(({ oid, value }) => {
    return derSet([
      derSequence([
        derOid(oid),
        derUtf8String(value),
      ]),
    ]);
  });
  return derSequence(rdnSequence);
}

// Well-known OIDs
const OID_CN = '2.5.4.3'; // commonName
const OID_O = '2.5.4.10'; // organizationName
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';
const OID_AUTHORITY_KEY_IDENTIFIER = '2.5.29.35';
const OID_SUBJECT_KEY_IDENTIFIER = '2.5.29.14';

/**
 * Extract the SubjectPublicKeyInfo DER from a PEM public key.
 */
function extractSpkiDer(publicKeyPem) {
  const b64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');
  return Buffer.from(b64, 'base64');
}

/**
 * Compute a SHA-1 hash of the public key for Subject Key Identifier.
 */
function computeKeyId(spkiDer) {
  // The SubjectPublicKeyInfo contains AlgorithmIdentifier + BIT STRING
  // The BIT STRING content (after tag, length, unused bits byte) is the raw public key
  // For SKI, we hash the BIT STRING value within the SPKI
  // Simplified: hash the whole SPKI DER
  return createHash('sha1').update(spkiDer).digest();
}

/**
 * Generate a self-signed X.509 CA certificate using pure Node.js crypto.
 */
function generateCACert(keyPair, days) {
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + days * 86400000);

  const issuerName = derName([
    { oid: OID_CN, value: 'OpenClaw Terminal CA' },
    { oid: OID_O, value: 'OpenClaw' },
  ]);

  const spkiDer = extractSpkiDer(keyPair.publicKey);
  const keyId = computeKeyId(spkiDer);

  // serial number
  const serial = derInteger(randomBytes(16));

  // signature algorithm
  const sigAlg = derSequence([derOid(OID_SHA256_WITH_RSA), Buffer.from([0x05, 0x00])]);

  // validity
  const validity = derSequence([
    derGeneralizedTime(notBefore),
    derGeneralizedTime(notAfter),
  ]);

  // extensions
  const extensions = derContext(3, derSequence([
    // Basic Constraints: CA=TRUE
    derSequence([
      derOid(OID_BASIC_CONSTRAINTS),
      Buffer.from([0x01, 0x01, 0xff]), // critical = TRUE
      derOctetString(derSequence([
        Buffer.from([0x01, 0x01, 0xff]), // cA = TRUE
      ])),
    ]),
    // Key Usage: keyCertSign, cRLSign
    derSequence([
      derOid(OID_KEY_USAGE),
      Buffer.from([0x01, 0x01, 0xff]), // critical = TRUE
      derOctetString(
        derBitString(Buffer.from([0x06])), // keyCertSign(5) | cRLSign(6)
      ),
    ]),
    // Subject Key Identifier
    derSequence([
      derOid(OID_SUBJECT_KEY_IDENTIFIER),
      derOctetString(derOctetString(keyId)),
    ]),
  ]));

  // TBS Certificate
  const tbsCert = derSequence([
    derContext(0, derInteger(Buffer.from([0x02]))), // version: v3
    serial,
    sigAlg,
    issuerName, // issuer = subject (self-signed)
    validity,
    issuerName, // subject
    spkiDer,
    extensions,
  ]);

  // Sign the TBS certificate
  const signer = createSign('SHA256');
  signer.update(tbsCert);
  const signature = signer.sign(keyPair.privateKey);

  // Assemble the full certificate
  const cert = derSequence([
    tbsCert,
    sigAlg,
    derBitString(signature),
  ]);

  return toPem(cert, 'CERTIFICATE');
}

/**
 * Generate a certificate signed by the CA.
 */
function generateSignedCert(subjectKeyPair, caKeyPair, caCertPem, subject, days, sans) {
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + days * 86400000);

  const subjectName = derName(subject);

  const caCert = new X509Certificate(caCertPem);
  const issuerDer = extractIssuerFromCert(caCertPem);

  const spkiDer = extractSpkiDer(subjectKeyPair.publicKey);
  const caSpkiDer = extractSpkiDer(caKeyPair.publicKey);
  const caKeyId = computeKeyId(caSpkiDer);

  const serial = derInteger(randomBytes(16));
  const sigAlg = derSequence([derOid(OID_SHA256_WITH_RSA), Buffer.from([0x05, 0x00])]);

  const validity = derSequence([
    derGeneralizedTime(notBefore),
    derGeneralizedTime(notAfter),
  ]);

  // Build extensions
  const extensionList = [
    // Subject Key Identifier
    derSequence([
      derOid(OID_SUBJECT_KEY_IDENTIFIER),
      derOctetString(derOctetString(computeKeyId(spkiDer))),
    ]),
    // Authority Key Identifier
    derSequence([
      derOid(OID_AUTHORITY_KEY_IDENTIFIER),
      derOctetString(derSequence([
        // keyIdentifier [0]
        Buffer.concat([
          Buffer.from([0x80]),
          derLength(caKeyId.length),
          caKeyId,
        ]),
      ])),
    ]),
  ];

  // Add Subject Alternative Names if provided
  if (sans && sans.length > 0) {
    const sanEntries = sans.map((san) => {
      if (san.type === 'dns') {
        const buf = Buffer.from(san.value, 'ascii');
        return Buffer.concat([Buffer.from([0x82]), derLength(buf.length), buf]);
      }
      if (san.type === 'ip') {
        const parts = san.value.split('.').map(Number);
        const buf = Buffer.from(parts);
        return Buffer.concat([Buffer.from([0x87]), derLength(buf.length), buf]);
      }
      throw new Error(`Unknown SAN type: ${san.type}`);
    });

    extensionList.push(
      derSequence([
        derOid(OID_SUBJECT_ALT_NAME),
        derOctetString(derSequence(sanEntries)),
      ]),
    );
  }

  const extensions = derContext(3, derSequence(extensionList));

  const tbsCert = derSequence([
    derContext(0, derInteger(Buffer.from([0x02]))), // version: v3
    serial,
    sigAlg,
    issuerDer,
    validity,
    subjectName,
    spkiDer,
    extensions,
  ]);

  const signer = createSign('SHA256');
  signer.update(tbsCert);
  const signature = signer.sign(caKeyPair.privateKey);

  const cert = derSequence([
    tbsCert,
    sigAlg,
    derBitString(signature),
  ]);

  return toPem(cert, 'CERTIFICATE');
}

/**
 * Extract the issuer Name DER from a PEM certificate.
 * Parses the TBS certificate to find the issuer field.
 */
function extractIssuerFromCert(certPem) {
  const b64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s/g, '');
  const certDer = Buffer.from(b64, 'base64');

  // Parse outer SEQUENCE -> TBS SEQUENCE -> skip version, serial, sigAlg -> issuer
  let offset = 0;

  // Outer SEQUENCE
  if (certDer[offset] !== 0x30) throw new Error('Expected SEQUENCE');
  offset++;
  const { length: outerLen, bytesRead: outerBytesRead } = readDerLength(certDer, offset);
  offset += outerBytesRead;

  // TBS SEQUENCE
  if (certDer[offset] !== 0x30) throw new Error('Expected TBS SEQUENCE');
  offset++;
  const { length: tbsLen, bytesRead: tbsBytesRead } = readDerLength(certDer, offset);
  offset += tbsBytesRead;

  // Skip version [0] EXPLICIT
  if ((certDer[offset] & 0xe0) === 0xa0) {
    offset++;
    const { length: vLen, bytesRead: vBytesRead } = readDerLength(certDer, offset);
    offset += vBytesRead + vLen;
  }

  // Skip serial INTEGER
  if (certDer[offset] !== 0x02) throw new Error('Expected INTEGER (serial)');
  offset++;
  const { length: serialLen, bytesRead: serialBytesRead } = readDerLength(certDer, offset);
  offset += serialBytesRead + serialLen;

  // Skip signature algorithm SEQUENCE
  if (certDer[offset] !== 0x30) throw new Error('Expected SEQUENCE (sigAlg)');
  offset++;
  const { length: sigLen, bytesRead: sigBytesRead } = readDerLength(certDer, offset);
  offset += sigBytesRead + sigLen;

  // Now at issuer: read the full SEQUENCE
  if (certDer[offset] !== 0x30) throw new Error('Expected SEQUENCE (issuer)');
  const issuerStart = offset;
  offset++;
  const { length: issuerLen, bytesRead: issuerBytesRead } = readDerLength(certDer, offset);
  offset += issuerBytesRead + issuerLen;

  return certDer.subarray(issuerStart, offset);
}

/**
 * Read a DER length field.
 */
function readDerLength(buf, offset) {
  const first = buf[offset];
  if (first < 0x80) {
    return { length: first, bytesRead: 1 };
  }
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) {
    length = (length << 8) | buf[offset + 1 + i];
  }
  return { length, bytesRead: 1 + numBytes };
}

/**
 * Convert DER buffer to PEM format.
 */
function toPem(derBuffer, type) {
  const b64 = derBuffer.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----\n`;
}

/**
 * Generate an RSA key pair and return PEM strings.
 */
function generateRsaKeyPair(bits) {
  return generateKeyPairSync('rsa', {
    modulusLength: bits,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const caKeyPath = path.join(OUTPUT_DIR, 'ca-key.pem');
  const caCertPath = path.join(OUTPUT_DIR, 'ca.pem');
  const apiKeyPath = path.join(OUTPUT_DIR, 'api-client-key.pem');
  const apiCertPath = path.join(OUTPUT_DIR, 'api-client.pem');
  const workerKeyPath = path.join(OUTPUT_DIR, 'worker-key.pem');
  const workerCertPath = path.join(OUTPUT_DIR, 'worker.pem');

  // Skip generation if certs already exist
  if (fs.existsSync(caCertPath) && fs.existsSync(apiCertPath) && fs.existsSync(workerCertPath)) {
    console.log('Certificates already exist, skipping generation.');
    process.exit(0);
  }

  console.log(`Generating mTLS certificates in ${OUTPUT_DIR}...`);

  // 1. Generate CA
  console.log('  Generating CA...');
  const caKeyPair = generateRsaKeyPair(4096);
  const caCertPem = generateCACert(caKeyPair, CA_DAYS);

  fs.writeFileSync(caKeyPath, caKeyPair.privateKey, { mode: 0o600 });
  fs.writeFileSync(caCertPath, caCertPem);

  // 2. Generate API client certificate
  console.log('  Generating API client certificate...');
  const apiKeyPair = generateRsaKeyPair(2048);
  const apiCertPem = generateSignedCert(
    apiKeyPair,
    caKeyPair,
    caCertPem,
    [
      { oid: OID_CN, value: 'openclaw-api-client' },
      { oid: OID_O, value: 'OpenClaw' },
    ],
    CERT_DAYS,
    null,
  );

  fs.writeFileSync(apiKeyPath, apiKeyPair.privateKey, { mode: 0o600 });
  fs.writeFileSync(apiCertPath, apiCertPem);

  // 3. Generate worker server certificate with SANs
  console.log('  Generating worker server certificate...');
  const workerKeyPair = generateRsaKeyPair(2048);
  const workerCertPem = generateSignedCert(
    workerKeyPair,
    caKeyPair,
    caCertPem,
    [
      { oid: OID_CN, value: 'openclaw-tmux-worker' },
      { oid: OID_O, value: 'OpenClaw' },
    ],
    CERT_DAYS,
    [
      { type: 'dns', value: 'tmux-worker' },
      { type: 'dns', value: 'localhost' },
      { type: 'ip', value: '127.0.0.1' },
    ],
  );

  fs.writeFileSync(workerKeyPath, workerKeyPair.privateKey, { mode: 0o600 });
  fs.writeFileSync(workerCertPath, workerCertPem);

  console.log('mTLS certificates generated successfully.');
  console.log(`  CA:     ${caCertPath}`);
  console.log(`  API:    ${apiCertPath} / ${apiKeyPath}`);
  console.log(`  Worker: ${workerCertPath} / ${workerKeyPath}`);
}

main();
