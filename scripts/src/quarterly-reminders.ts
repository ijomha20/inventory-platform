import { sendOpsAlert } from "../../artifacts/api-server/src/lib/emailService.js";

async function main() {
  await sendOpsAlert(
    "warning",
    "Quarterly review reminder",
    "<p>Review overdue quarterly controls: allow-list audit, DR drill, and self-heal gate health checks.</p>",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

