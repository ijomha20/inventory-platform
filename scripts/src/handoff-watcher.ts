import { sendOpsAlert } from "../../artifacts/api-server/src/lib/emailService.js";

async function main() {
  const phase = process.argv[2] ?? "unknown-phase";
  const hours = Number(process.argv[3] ?? "4");
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("Usage: tsx scripts/src/handoff-watcher.ts <phase> <hours>");
  }
  await sendOpsAlert(
    "info",
    `Self-heal plan stalled at model handoff (${phase})`,
    `<p>The execution plan is stalled at model handoff <strong>${phase}</strong>.</p><p>Idle threshold reached: <strong>${hours}h</strong>.</p>`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

