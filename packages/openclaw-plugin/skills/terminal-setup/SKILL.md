---
name: terminal-setup
description: Set up a new terminal connection with credentials and verification
args:
  - name: host
    description: Hostname or IP address of the remote server
    required: true
  - name: label
    description: Friendly name for this connection
    required: false
---

Set up a new terminal connection to "{{host}}" and verify it works:

1. **Create Credentials First**
   - Ask the user for their preferred auth method (password, SSH key, or key file)
   - Use `terminal_credential_create` to store the credential securely
   - Note the returned credential ID for the next step

2. **Create the Connection**
   - Use `terminal_connection_create` with the host "{{host}}" and the `credential_id` from step 1
   - Set the name to "{{label}}" if provided, otherwise use the hostname
   - Configure the connection type (SSH is the default)

3. **Test the Connection**
   - Use `terminal_connection_test` with the connection ID to verify it works
   - If the test fails, report the error details clearly
   - Suggest common fixes (wrong port, firewall, credential issues)

4. **Confirm Setup**
   - Use `terminal_connection_list` to show the new connection in the list
   - Report the connection ID for future reference
   - Suggest next steps (starting a session, creating a tunnel)

## Important Notes:
- Never store or log raw passwords or private keys
- If SSH key auth is chosen, the key content should be provided securely
- Default SSH port is 22; ask if a non-standard port is needed
