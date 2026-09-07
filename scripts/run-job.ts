import { JOB_NAMES, isJobName, runJobs } from "../lib/jobs";
import { fromISODate, todayInDhaka, formatDate } from "../lib/dates";
import { args, finish, optional } from "./_cli";

/**
 * Run a scheduled job by hand.
 *
 * A permanent ops tool, not scaffolding. When somebody says "the certificate
 * warnings have stopped", the first useful thing is to run the job in front of
 * you and watch what it says it considered — the answer is nearly always that
 * it considered the right rows and found nothing due, which points at the
 * schedule rather than the code.
 *
 *   npx tsx scripts/run-job.ts                      every job, today
 *   npx tsx scripts/run-job.ts --job certificates
 *   npx tsx scripts/run-job.ts --job certificates --on 2027-03-14
 *
 * `--on` moves the clock the job THINKS it is, which is how you check the
 * ladder lands where §8 says without waiting four months for it. It changes
 * nothing about what the job then does: it really does send, really does write
 * to the log, and really does claim the day.
 */
async function main() {
  const values = args();
  const requested = optional(values, "job") ?? "all";
  const on = optional(values, "on");

  if (requested !== "all" && !isJobName(requested)) {
    console.error(`\nUnknown job "${requested}".\n\n  Known: all, ${JOB_NAMES.join(", ")}\n`);
    process.exit(1);
  }

  const today = on ? fromISODate(on) : todayInDhaka();
  if (!today) {
    console.error(`\n"${on}" is not a date. Use YYYY-MM-DD.\n`);
    process.exit(1);
  }

  console.log(`\nRunning ${requested === "all" ? "every job" : requested}, as at ${formatDate(today)}.\n`);

  const results = await runJobs(requested as never, today);
  for (const result of results) {
    console.log(`${result.job}: ${result.considered} considered, ${result.acted} acted on`);
    for (const note of result.notes) console.log(`    ${note}`);
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
