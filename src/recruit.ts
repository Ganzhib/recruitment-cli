#!/usr/bin/env node
import { runRecruitCli } from './cli/program.js';

process.exitCode = await runRecruitCli(process.argv.slice(2));
