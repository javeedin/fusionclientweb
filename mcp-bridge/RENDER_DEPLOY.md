# Deploying GL Account Analysis MCP Server to Render

This guide walks through deploying the GL Account Analysis MCP server to Render.

## Prerequisites

1. **Render Account** — Sign up at https://render.com
2. **GitHub Repository** — Push this code to a GitHub repository (public or private)
3. **Oracle Credentials** — Have your Oracle APEX credentials ready

## Step 1: Create a Render Account

1. Go to https://render.com
2. Sign up with GitHub (recommended for easy integration)
3. Verify your email

## Step 2: Create a New Web Service

1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository:
   - Click **"Connect repository"**
   - Authorize Render to access your GitHub account
   - Select the repository containing this code
   - Specify the root directory: `mcp-bridge`

## Step 3: Configure the Service

Fill in the following details:

| Field | Value |
|-------|-------|
| **Name** | `gl-account-analysis-mcp` |
| **Environment** | `Docker` |
| **Region** | Choose closest to you (e.g., `Ohio` for US-East) |
| **Branch** | `main` (or your deployment branch) |
| **Autodeploy** | ✅ Enable (automatic redeploy on push) |

## Step 4: Set Environment Variables

Click **"Advanced"** and add these environment variables:

| Key | Value | Notes |
|-----|-------|-------|
| `ORACLE_BASE_URL` | `https://your-oracle-domain` | Your Oracle APEX domain (e.g., `https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com`) |
| `ORACLE_USERNAME` | `your_username` | APEX username |
| `ORACLE_PASSWORD` | `your_password` | APEX password (use Render's encrypted storage) |
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `3000` | (Auto-assigned by Render, usually 3000) |

## Step 5: Choose Plan

- **Free Tier**: Good for testing/development (spins down after 15 min inactivity)
- **Standard**: $7/month (always running, recommended for production)

For production, select **"Standard"** or higher.

## Step 6: Deploy

1. Click **"Create Web Service"**
2. Render will automatically:
   - Build the Docker image
   - Deploy the container
   - Assign a public URL (e.g., `https://gl-account-analysis-mcp.onrender.com`)

Monitor the deployment in the **"Logs"** tab. Look for:
```
[GL MCP INFO] GL MCP Server initializing...
[GL MCP INFO] Config: ORACLE_DOMAIN=...
[GL MCP INFO] MCP Server listening on port 3000
```

## Step 7: Verify Deployment

Once deployed, test the health endpoint:

```bash
curl https://gl-account-analysis-mcp.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "uptime": 123.45
}
```

## Step 8: Configure MCP with Claude Desktop

Add the following to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gl-account-analysis": {
      "command": "node",
      "args": ["your-local-mcp-server.js"],
      "env": {
        "MCP_SERVER_URL": "https://gl-account-analysis-mcp.onrender.com",
        "MCP_AUTH_TOKEN": "your-bearer-token-if-needed"
      }
    }
  }
}
```

Or use HTTP client directly:

```bash
curl -X POST https://gl-account-analysis-mcp.onrender.com/tools/getGLAccountAnalysis \
  -H "Content-Type: application/json" \
  -d '{
    "ledger_name": "Primary Ledger",
    "period_names": ["Jan-26"],
    "company": "01",
    "account": "1111103"
  }'
```

## Monitoring & Maintenance

### View Logs
1. Go to your Render dashboard
2. Click on **"gl-account-analysis-mcp"** service
3. Check the **"Logs"** tab

### Environment Variables
1. Click **"Environment"** tab
2. Edit variables as needed
3. Service auto-restarts on variable change

### Auto-Redeploy
- Enabled by default — every push to your branch triggers a new deployment
- Disable in **"Settings"** → **"Auto-deploy"** if needed

### Manual Redeploy
- Click **"Deploys"** tab
- Click **"Redeploy"** on any previous deployment
- Or push a new commit to trigger automatic redeploy

## Troubleshooting

### Service Won't Start
1. Check **Logs** tab for error messages
2. Verify all environment variables are set
3. Ensure Oracle credentials are correct

### Connection Timeout
1. Verify `ORACLE_BASE_URL` is correct
2. Check network access to Oracle APEX from Render's region
3. Try different region if needed

### No MCP Tools Available
1. Verify service is running (green status)
2. Check `/tools` endpoint returns available tools
3. Verify MCP client can reach the service URL

### Free Tier Spins Down
The free tier automatically spins down after 15 minutes of inactivity. Upgrade to **Standard** ($7/month) to keep it running 24/7.

## Updating Deployment

When you make changes to the MCP server:

```bash
# 1. Commit and push to GitHub
git add .
git commit -m "Update MCP server"
git push origin main

# 2. Render automatically builds and deploys
# Check the "Deploys" tab to monitor progress
```

## Next Steps

1. ✅ Deploy to Render
2. ✅ Configure Oracle credentials
3. ✅ Test with health endpoint
4. ✅ Integrate with Claude Desktop or other MCP clients
5. ⏳ Monitor logs and performance
6. ⏳ Scale up if needed (upgrade plan)

## Support & Resources

- **Render Docs**: https://render.com/docs
- **MCP Spec**: https://spec.modelcontextprotocol.io/
- **Oracle APEX REST**: Check your Oracle APEX REST Data Services configuration

---

**Deployment URL**: `https://gl-account-analysis-mcp.onrender.com`
**Service Name**: `gl-account-analysis-mcp`
