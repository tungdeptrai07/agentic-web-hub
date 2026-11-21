/**
 * Worldwide Agentic Web MVP 0.3 — In-Browser Agent Network Runtime
 * Loads agent-manifest.json + network.json and executes using visitor-supplied LLM credentials.
 */

export async function loadAgentSite(baseUrl = ".") {
  const manifestUrl = new URL("agent-manifest.json", baseUrl === "." ? window.location.href : baseUrl).href;
  const manifest = await fetch(manifestUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch manifest (${r.status})`);
    return r.json();
  });

  const primary = manifest.networks?.[0];
  if (!primary) throw new Error("No networks defined in agent-manifest.json");

  const defUrl = new URL(primary.definitionUrl, manifestUrl).href;
  const network = await fetch(defUrl).then((r) => {
    if (!r.ok) throw new Error(`Failed to fetch network definition (${r.status})`);
    return r.json();
  });

  return { manifest, network, manifestUrl, defUrl };
}

export async function runInBrowserNetwork({ network, prompt, provider, apiKey, model, peerUrl = "" }) {
  const front = network.agents.find((a) => a.id === network.frontAgent) || network.agents[0];
  const trace = [
    `[Manifest] Loaded network "${network.networkId}" (frontAgent: ${front.id})`,
  ];

  if (peerUrl) {
    trace.push(`[Peer Consent] Visitor authorized peer discovery at ${peerUrl}`);
  }

  if (!apiKey) {
    trace.push(`[Local Deterministic Fallback] No visitor API key supplied; running local structural agent pass.`);
    return {
      trace,
      output: `[${front.id} -> fact_auditor]\nPrompt received: "${prompt}"\nConfigured agents: ${network.agents.map((a) => a.id).join(" -> ")}.\nTo run live LLM reasoning in-browser, paste your own OpenAI or Gemini API key above (stored only in memory, never sent to site host).`,
    };
  }

  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          { role: "system", content: `${front.instructions} Available sub-agents: ${network.agents.map((a) => `${a.id} (${a.role})`).join(", ")}.` },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${resp.status}`);
    trace.push(`[OpenAI] Executed ${model || "gpt-4o-mini"} directly from visitor browser`);
    return { trace, output: data.choices?.[0]?.message?.content || "" };
  }

  if (provider === "gemini") {
    const m = model || "gemini-2.5-flash";
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${front.instructions}\n\nUser request: ${prompt}` }] }],
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error?.message || `Gemini HTTP ${resp.status}`);
    trace.push(`[Gemini] Executed ${m} directly from visitor browser`);
    return { trace, output: data.candidates?.[0]?.content?.parts?.[0]?.text || "" };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
