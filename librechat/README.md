# LibreChat + Oracle GL MCP Server

Self-hosted [LibreChat](https://www.librechat.ai/) wired to:

- **Anthropic Claude** via your `ANTHROPIC_API_KEY` (same key as Admin → Claude AI Key Settings)
- **Oracle GL MCP server** (`electron/gl-mcp-server.cjs`) running in stdio mode inside the
  LibreChat container — so Claude in LibreChat can call the same GL tools as Claude Desktop.

## Quick start

```bash
cd librechat

# 1. Create your .env from the template and fill in the values
cp .env.example .env
#    - ANTHROPIC_API_KEY  → your sk-ant-... key
#    - ORACLE_USERNAME / ORACLE_PASSWORD → ORDS credentials (or SKIP_AUTH=1)
#    - regenerate the CREDS/JWT secrets (commands are in .env.example)

# 2. Start it
docker compose up -d

# 3. Open http://localhost:3080 — create a local account, pick the
#    "Claude (Oracle ERP)" endpoint, and enable the "oracle-gl" MCP tools
#    from the tools selector in the chat input.
```

Then in the ERP app: **Home → LibreChat AI Chat** (route `/librechat`) embeds
`http://localhost:3080`. Use "Open in New Window" if your browser blocks the iframe.

## What the compose file does

| Service   | Purpose                                                        |
|-----------|----------------------------------------------------------------|
| `api`     | LibreChat itself (port **3080**)                               |
| `mongodb` | LibreChat's datastore (users, conversations)                   |

The repo's `electron/` folder is mounted read-only at `/app/mcp` inside the `api`
container, and `librechat.yaml` registers the MCP server as:

```
node /app/mcp/gl-mcp-server.cjs --stdio
```

`gl-mcp-server.cjs` needs its siblings `mcp-call-logger.cjs` and `ords-token.cjs`,
which is why the whole `electron/` directory is mounted rather than one file.

## MCP server environment

Set in `.env`, passed through `librechat.yaml → mcpServers.oracle-gl.env`:

| Variable          | Meaning                                                            |
|-------------------|--------------------------------------------------------------------|
| `ORACLE_BASE_URL` | Oracle APEX domain (defaults to the BUIMERC cloud instance)        |
| `ORACLE_USERNAME` | ORDS auth user (used by `ords-token.cjs`)                          |
| `ORACLE_PASSWORD` | ORDS auth password                                                 |
| `SKIP_AUTH`       | `1` to call ORDS without a token (if the endpoints are open)       |

## Notes

- **Never commit `.env`** — it holds the real Anthropic key and DB credentials
  (`.gitignore` in this folder covers it).
- The Anthropic key can also be left as `user_provided` in `.env`, in which case each
  LibreChat user pastes their own key under Settings → API keys.
- To update LibreChat: `docker compose pull && docker compose up -d`.
- Logs: `docker compose logs -f api` (MCP startup problems show up here — look for
  `oracle-gl`).
