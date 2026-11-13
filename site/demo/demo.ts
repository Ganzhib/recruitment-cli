import { runRecruitCli } from '../../src/cli/program.js';
process.exitCode = await runRecruitCli(['demo', ...process.argv.slice(2)]);
