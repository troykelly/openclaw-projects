# Troubleshooting

This guide covers common issues and their solutions.

## First Step: Run the Health Check

Before investigating specific errors, run the built-in status command:

```bash
openclaw openclaw-projects status
```

This checks API connectivity, authentication, and response time in a single command.

**Healthy output:**

```
openclaw-projects status:
  API URL:    http://localhost:3000
  Status:     healthy
  Auth:       valid
  Latency:    12ms
```

**Unhealthy output:**

```
openclaw-projects status:
  API URL:    http://localhost:3000
  Status:     unhealthy
  Error:      Connection refused (ECONNREFUSED)
```

The status command verifies:
- **API connectivity** -- can the plugin reach the backend at the configured `apiUrl`?
- **Authentication** -- is the configured API key accepted by the backend?
- **Response time** -- latency in milliseconds (high latency may indicate network or backend performance issues)

If the status is healthy but you still have issues, continue with the specific sections below.

## Connection Issues

### "Connection refused" or "ECONNREFUSED"

**Symptoms:**
- Tools fail with connection errors
- Plugin fails to load

**Causes and Solutions:**

1. **Backend not running**
   ```bash
   # Check if backend is accessible
   curl https://your-api-url.example.com/health
   ```

2. **Incorrect apiUrl**
   - Verify URL in configuration
   - Ensure no trailing slash
   - Check for typos

3. **Firewall blocking connection**
   - Check firewall rules
   - Verify network connectivity

### "CERTIFICATE_VERIFY_FAILED" or SSL errors

**Symptoms:**
- HTTPS connections fail
- SSL/TLS errors in logs

**Solutions:**

1. **Self-signed certificates (development)**
   ```bash
   # Temporarily disable verification (DEV ONLY)
   NODE_TLS_REJECT_UNAUTHORIZED=0 openclaw ...
   ```

2. **Certificate chain issues**
   - Verify intermediate certificates are configured
   - Update CA certificates on system

3. **Expired certificate**
   - Contact backend administrator to renew

## Authentication Issues

### "Unauthorized" or 401 errors

**Symptoms:**
- All tool calls fail with 401
- "Invalid API key" messages

**Solutions:**

1. **Verify API key is correct**
   ```bash
   # Test with curl
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://your-api-url.example.com/health
   ```

2. **Check secret retrieval method**

   For `apiKeyFile`:
   ```bash
   # Verify file exists and is readable
   cat ~/.secrets/openclaw-api-key
   ```

   For `apiKeyCommand`:
   ```bash
   # Test command directly
   op read op://Personal/openclaw/api_key
   ```

3. **Quickstart compose has auth disabled**
   - The quickstart compose sets `OPENCLAW_PROJECTS_AUTH_DISABLED=true` by default, so `apiKey` is not needed
   - If you have overridden this to `false` (enabling auth), ensure your `apiKey` matches `OPENCLAW_PROJECTS_AUTH_SECRET` in the backend `.env`

4. **API key expired or revoked**
   - Generate new key in backend
   - Update configuration

### "Secret command timed out"

**Symptoms:**
- Plugin fails to load
- Timeout errors during initialization

**Solutions:**

1. **Increase timeout**
   ```yaml
   plugins:
     entries:
       openclaw-projects:
         config:
           secretCommandTimeout: 10000  # 10 seconds
   ```

2. **Check secret manager authentication**
   ```bash
   # For 1Password
   op whoami

   # For AWS
   aws sts get-caller-identity
   ```

3. **Command requires interactive input**
   - Ensure command runs non-interactively
   - Check for password prompts

## Memory Tools

### "No memories found" when you expect results

**Solutions:**

1. **Check minRecallScore setting**
   ```yaml
   plugins:
     entries:
       openclaw-projects:
         config:
           minRecallScore: 0.5  # Lower threshold
   ```

2. **Try broader query**
   - Use more general terms
   - Check for typos in query

3. **Verify memories were stored**
   - Use `memory_recall` with empty category
   - Check backend directly

### "Memory store failed"

**Solutions:**

1. **Content too long**
   - Maximum 2000 characters
   - Summarize content before storing

2. **Invalid category**
   - Use: preference, fact, decision, context

3. **Database connection issue**
   - Check backend logs
   - Verify database is running

## Messaging Tools

### "SMS send failed" or Twilio errors

**Common error codes:**

| Code | Meaning | Solution |
|------|---------|----------|
| 21211 | Invalid 'To' number | Use E.164 format (+15551234567) |
| 21608 | Unverified number | Verify number in Twilio or upgrade account |
| 21610 | Recipient blocked | Recipient opted out |
| 21614 | Invalid 'From' number | Check twilioPhoneNumber config |

**Solutions:**

1. **Verify Twilio credentials**
   ```bash
   curl -X POST \
     -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
     https://api.twilio.com/2010-04-01/Accounts
   ```

2. **Check phone number format**
   - Must be E.164: `+15551234567`
   - Include country code

3. **Trial account limitations**
   - Verify recipient number in Twilio console
   - Upgrade to paid account

### "Email send failed" or Postmark errors

**Common issues:**

| Error | Solution |
|-------|----------|
| Inactive recipient | Recipient previously bounced/complained |
| Invalid 'From' | Verify sender domain in Postmark |
| Rate limit | Wait or contact Postmark support |

**Solutions:**

1. **Verify Postmark credentials**
   ```bash
   curl -X GET \
     -H "X-Postmark-Server-Token: YOUR_TOKEN" \
     https://api.postmarkapp.com/server
   ```

2. **Check sender domain**
   - Domain must be verified in Postmark
   - Check SPF/DKIM records

## Plugin Loading

### "Plugin not found"

**Solutions:**

1. **Verify installation**
   ```bash
   openclaw plugins list
   ```

2. **Check plugin path**
   ```bash
   openclaw config get pluginPaths
   ```

3. **Reinstall plugin**
   ```bash
   openclaw plugins uninstall @troykelly/openclaw-projects
   openclaw plugins install @troykelly/openclaw-projects
   ```

### "Configuration validation failed"

**Common causes:**

1. **Missing required field**
   ```yaml
   plugins:
     entries:
       openclaw-projects:
         config:
           apiUrl: "https://api.example.com"       # Required
           # apiKey is optional — only needed when backend auth is enabled
   ```

2. **Invalid field type**
   - Check field types in configuration reference
   - Ensure numbers aren't quoted

3. **Invalid email format**
   ```yaml
   plugins:
     entries:
       openclaw-projects:
         config:
           postmarkFromEmail: "invalid"  # Must be valid email
   ```

### "Cannot find module" errors

**Solutions:**

1. **Rebuild plugin**
   ```bash
   cd /path/to/plugin
   pnpm build
   ```

2. **Clear pnpm cache and reinstall**
   ```bash
   pnpm store prune
   pnpm install
   ```

3. **Check Node.js version**
   ```bash
   node --version  # Should be 20+
   ```

## Performance Issues

### Slow tool responses

**Solutions:**

1. **Check network latency**
   ```bash
   ping your-api-url.example.com
   ```

2. **Increase timeout**
   ```yaml
   plugins:
     entries:
       openclaw-projects:
         config:
           timeout: 60000  # 60 seconds
   ```

3. **Check backend performance**
   - Review backend logs
   - Monitor database query times

### Memory recall takes too long

**Solutions:**

1. **Reduce limit**
   - Fetch fewer results

2. **Backend optimization**
   - Ensure pgvector indexes exist
   - Review embedding generation time

## Debugging

### Enable debug logging

```yaml
plugins:
  entries:
    openclaw-projects:
      config:
        debug: true
```

This will output:
- API request/response details
- Tool invocation parameters
- Error stack traces

### View plugin logs

Logs are output to stderr. Capture them:

```bash
openclaw 2>&1 | tee openclaw.log
```

### Test individual components

```bash
# Test API connectivity
curl -v https://your-api-url.example.com/health

# Test secret command
time op read op://Personal/openclaw/api_key

# Test Twilio credentials
curl -u "SID:TOKEN" https://api.twilio.com/2010-04-01/Accounts
```

## Getting Help

If issues persist:

1. Check GitHub Issues: https://github.com/troykelly/openclaw-projects/issues
2. Enable debug logging and collect logs
3. Include configuration (with secrets redacted)
4. Include error messages and stack traces
5. Open a new issue with reproduction steps
