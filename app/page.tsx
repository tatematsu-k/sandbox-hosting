export const dynamic = "force-static";

export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720 }}>
      <h1>Sandbox Hosting</h1>
      <p>
        Private, IP-restricted HTML sandbox host. Upload via Slack slash command
        or the Claude Code skill.
      </p>
      <ul>
        <li>
          <code>POST /api/upload</code> — Bearer token (Claude Code)
        </li>
        <li>
          <code>POST /api/slack/upload</code> — Slack signing secret
        </li>
        <li>
          <code>POST /api/list</code> · <code>POST /api/activate</code> · <code>POST /api/delete</code>
        </li>
      </ul>
      <p>
        See <code>docs/superpowers/specs/2026-06-04-sandbox-hosting-design.md</code> for full spec.
      </p>
    </main>
  );
}
