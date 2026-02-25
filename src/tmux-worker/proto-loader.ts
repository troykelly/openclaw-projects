/**
 * gRPC proto-loader setup for the TerminalService.
 *
 * Uses @grpc/proto-loader for dynamic loading — no build step required.
 * The .proto file is the single source of truth for the service definition.
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the terminal.proto file, resolved from project root. */
export const PROTO_PATH = path.resolve(
  __dirname,
  '../../proto/terminal/v1/terminal.proto',
);

/** Proto-loader options for full type fidelity. */
const LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.resolve(__dirname, '../../proto')],
};

/** Loaded package definition (lazy singleton). */
let _packageDefinition: protoLoader.PackageDefinition | undefined;

/** Loaded gRPC object (lazy singleton). */
let _grpcObject: grpc.GrpcObject | undefined;

/**
 * Load the proto package definition. Cached after first call.
 */
export function loadPackageDefinition(): protoLoader.PackageDefinition {
  if (!_packageDefinition) {
    _packageDefinition = protoLoader.loadSync(PROTO_PATH, LOADER_OPTIONS);
  }
  return _packageDefinition;
}

/**
 * Load the gRPC object with all service constructors. Cached after first call.
 */
export function loadGrpcObject(): grpc.GrpcObject {
  if (!_grpcObject) {
    const packageDefinition = loadPackageDefinition();
    _grpcObject = grpc.loadPackageDefinition(packageDefinition);
  }
  return _grpcObject;
}

/**
 * Get the TerminalService service definition for server-side registration.
 */
export function getTerminalServiceDefinition(): grpc.ServiceDefinition {
  const grpcObject = loadGrpcObject();
  const openclaw = grpcObject.openclaw as grpc.GrpcObject;
  const terminal = openclaw.terminal as grpc.GrpcObject;
  const v1 = terminal.v1 as grpc.GrpcObject;
  const TerminalService = v1.TerminalService as grpc.ServiceClientConstructor;
  return TerminalService.service;
}

/**
 * Get the TerminalService client constructor for client-side connections.
 */
export function getTerminalServiceClient(): grpc.ServiceClientConstructor {
  const grpcObject = loadGrpcObject();
  const openclaw = grpcObject.openclaw as grpc.GrpcObject;
  const terminal = openclaw.terminal as grpc.GrpcObject;
  const v1 = terminal.v1 as grpc.GrpcObject;
  return v1.TerminalService as grpc.ServiceClientConstructor;
}
