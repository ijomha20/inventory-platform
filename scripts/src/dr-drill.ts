import { sendOpsAlert } from "../../artifacts/api-server/src/lib/emailService.js";

async function main() {
  await sendOpsAlert(
    "warning",
    "Quarterly DR drill due",
    "<p>Run <code>pnpm --filter @workspace/scripts dr-drill</code> with a scratch database target and update the Operations panel acknowledgment.</p>",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

