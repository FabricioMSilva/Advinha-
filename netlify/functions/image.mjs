const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

export default async function handler(request) {
  try {
    const reqUrl = new URL(request.url);
    const src = reqUrl.searchParams.get("u") || reqUrl.searchParams.get("url");
    if (!src) return new Response("Missing url", { status: 400 });

    // Basic validation - only allow http/https
    if (!/^https?:\/\//i.test(src)) return new Response("Invalid url", { status: 400 });

    // Prevent abuse - simple length check
    if (src.length > 2000) return new Response("Url too long", { status: 400 });

    // Build headers with Referer based on host
    const srcUrl = new URL(src);
    const headers = {
      "user-agent": USER_AGENT,
      "referer": srcUrl.origin + "/",
    };

    // Attempt fetch with retry for certain hosts
    let resp = await fetch(src, { headers });
    if (!resp.ok && srcUrl.hostname.includes("rainhadoslot")) {
      // Retry once for Rainha with slightly different Referer
      resp = await fetch(src, { headers: { ...headers, "referer": "https://rainhadoslot.com.br/" } });
    }
    if (!resp.ok) return new Response(`Upstream ${resp.status}`, { status: 502 });

    const contentType = resp.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await resp.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (err) {
    return new Response(String(err?.message || err), { status: 500 });
  }
}
