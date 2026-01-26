import { CONFIG } from "./config.js";

export async function getIdToken(params: {
  username: string;
  password: string;
}): Promise<string> {
  const form = new URLSearchParams();
  form.set("username", params.username);
  form.set("password", params.password);
  form.set("grant_type", "password");
  form.set("scope", CONFIG.scope);
  form.set("client_id", CONFIG.clientId);
  form.set("response_type", CONFIG.responseType);

  const res = await fetch(CONFIG.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `ERCOT token request failed (${res.status}). Body: ${text.slice(0, 400)}`
    );
  }

  const json = JSON.parse(text) as { id_token?: string };
  if (!json.id_token) throw new Error("Token response missing id_token.");
  return json.id_token;
}
