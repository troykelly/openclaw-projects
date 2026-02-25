#!/usr/bin/env node
/**
 * Certificate generation script for mTLS between API server and tmux worker.
 *
 * Generates:
 * - CA certificate and key
 * - API server client certificate (signed by CA)
 * - TMux worker server certificate (signed by CA)
 *
 * Output directory defaults to /certs, configurable via CERT_OUTPUT_DIR env var.
 *
 * Issue #1685 — mTLS between API server and tmux worker
 * Epic #1667 — TMux Session Management
 *
 * SECURITY NOTE: All arguments to execFileSync are hardcoded constants — no user
 * input is passed to the shell. This script runs as a Docker init service.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUTPUT_DIR = process.env.CERT_OUTPUT_DIR || '/certs';
const CA_DAYS = String(parseInt(process.env.CA_CERT_DAYS || '3650', 10));
const CERT_DAYS = String(parseInt(process.env.CERT_DAYS || '365', 10));

/** Subject fields for certificates. */
const CA_SUBJECT = '/CN=OpenClaw Terminal CA/O=OpenClaw';
const API_SUBJECT = '/CN=openclaw-api-client/O=OpenClaw';

/** Worker SANs — covers docker service name and localhost. */
const WORKER_SANS = 'DNS:tmux-worker,DNS:localhost,IP:127.0.0.1';

function openssl(args) {
  execFileSync('openssl', args, { stdio: 'pipe' });
}

function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const caKey = path.join(OUTPUT_DIR, 'ca-key.pem');
  const caCert = path.join(OUTPUT_DIR, 'ca.pem');
  const apiKey = path.join(OUTPUT_DIR, 'api-client-key.pem');
  const apiCsr = path.join(OUTPUT_DIR, 'api-client.csr');
  const apiCert = path.join(OUTPUT_DIR, 'api-client.pem');
  const workerKey = path.join(OUTPUT_DIR, 'worker-key.pem');
  const workerCsr = path.join(OUTPUT_DIR, 'worker.csr');
  const workerCert = path.join(OUTPUT_DIR, 'worker.pem');

  // Skip generation if certs already exist
  if (fs.existsSync(caCert) && fs.existsSync(apiCert) && fs.existsSync(workerCert)) {
    console.log('Certificates already exist, skipping generation.');
    process.exit(0);
  }

  console.log(`Generating mTLS certificates in ${OUTPUT_DIR}...`);

  // 1. Generate CA key and self-signed certificate
  console.log('  Generating CA...');
  openssl(['genrsa', '-out', caKey, '4096']);
  openssl(['req', '-new', '-x509', '-key', caKey, '-out', caCert, '-days', CA_DAYS, '-subj', CA_SUBJECT]);

  // 2. Generate API client certificate
  console.log('  Generating API client certificate...');
  openssl(['genrsa', '-out', apiKey, '2048']);
  openssl(['req', '-new', '-key', apiKey, '-out', apiCsr, '-subj', API_SUBJECT]);
  openssl(['x509', '-req', '-in', apiCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', apiCert, '-days', CERT_DAYS]);

  // 3. Generate worker server certificate with SANs
  console.log('  Generating worker server certificate...');
  openssl(['genrsa', '-out', workerKey, '2048']);

  // Create a temporary openssl config for SANs
  const extFile = path.join(OUTPUT_DIR, 'worker-ext.cnf');
  fs.writeFileSync(
    extFile,
    `[req]
distinguished_name = req_dn
req_extensions = v3_req
prompt = no

[req_dn]
CN = openclaw-tmux-worker
O = OpenClaw

[v3_req]
subjectAltName = ${WORKER_SANS}

[v3_ca]
subjectAltName = ${WORKER_SANS}
`,
  );

  openssl(['req', '-new', '-key', workerKey, '-out', workerCsr, '-config', extFile]);
  openssl(['x509', '-req', '-in', workerCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', workerCert, '-days', CERT_DAYS, '-extfile', extFile, '-extensions', 'v3_ca']);

  // Clean up temporary files
  for (const f of [apiCsr, workerCsr, extFile, path.join(OUTPUT_DIR, 'ca.srl')]) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }

  // Restrict key file permissions
  for (const f of [caKey, apiKey, workerKey]) {
    fs.chmodSync(f, 0o600);
  }

  console.log('mTLS certificates generated successfully.');
  console.log(`  CA:     ${caCert}`);
  console.log(`  API:    ${apiCert} / ${apiKey}`);
  console.log(`  Worker: ${workerCert} / ${workerKey}`);
}

main();
