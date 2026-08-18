const API_BASE = "https://backend.composio.dev/api/v3.1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function executeTool(slug, body) {
  const apiKey = requireEnv("COMPOSIO_API_KEY");
  const connectedAccountId = requireEnv("COMPOSIO_CONNECTED_ACCOUNT_ID");

  const res = await fetch(`${API_BASE}/tools/execute/${slug}`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connectedAccountId,
      toolkit_versions: "latest",
      body,
    }),
  });

  const json = await res.json();
  if (!res.ok || json.successful === false) {
    throw new Error(
      `Composio tool ${slug} failed: ${res.status} ${JSON.stringify(json)}`
    );
  }
  return json.data;
}
