---
name: api-integration
description: Onboard a new external API, configure credentials, and verify endpoints
args:
  - name: name
    description: Name or identifier for the API to integrate
    required: true
---

Onboard the external API "{{name}}" and verify it is searchable:

1. **Onboard the API**
   - Use `api_onboard` to register the new API source
   - Provide the API name "{{name}}" and any base URL or documentation URL the user supplies
   - Capture the returned source ID for subsequent steps

2. **Configure Credentials**
   - Use `api_credential_manage` to set up authentication for the API
   - Ask the user what auth method the API requires (API key, OAuth, bearer token, etc.)
   - Store the credentials securely against the onboarded source

3. **Verify Discoverability**
   - Use `api_recall` to search for the newly onboarded API by name
   - Confirm the API appears in search results with correct metadata
   - If not found, check the onboarding details and retry

4. **Refresh and Confirm**
   - Use `api_refresh` to ensure the API index is up to date
   - Use `api_recall` again to confirm the API and its endpoints are fully indexed
   - Report the final status and available endpoints to the user

## Important Notes:
- Never log or display raw API keys or tokens
- If the API requires OAuth, guide the user through the flow
- Suggest testing a sample endpoint after setup is complete
