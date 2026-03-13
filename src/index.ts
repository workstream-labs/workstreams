#!/usr/bin/env bun

import { Command } from "commander";
import { initCommand } from "./cli/init";
import { runCommand } from "./cli/run";

import { destroyCommand } from "./cli/destroy";
import { createCommand } from "./cli/create";
import { listCommand } from "./cli/list";
import { diffCommand } from "./cli/diff";
import { mergeCommand } from "./cli/merge";

import { dashboardCommand } from "./cli/dashboard";
import { promptCommand } from "./cli/prompt";
import { logsCommand } from "./cli/logs";
import { checkoutCommand } from "./cli/checkout";


const program = new Command();

program
  .name("ws")
  .description("Orchestrate parallel AI coding agents in isolated git worktrees")
  .version("0.1.0")
  .addHelpText("after", `
Quick start:
  ws init                        Initialize workstreams in this repo
  ws create auth -p "Add auth"   Define a workstream
  ws run                         Spawn agents for all workstreams
  ws run auth -p "fix tests"     Resume with new instructions
  ws list                        Check status
  ws logs auth                   View agent logs for a workstream
  ws dashboard                    Open interactive dashboard
  ws merge auth                  Merge completed work
  ws checkout auth               cd to a workstream worktree
  ws destroy --all               Tear everything down

Key options:
  init      -f, --force            Reinitialize even if already set up
  create    -p, --prompt <text>    Prompt for the agent
  run       -d, --dry-run          Preview which workstreams would run
            -p, --prompt <text>    Resume with new instructions
  diff      --raw                  Print raw diff instead of interactive viewer
  merge     --all                  Merge all successful workstreams
            --no-cleanup           Keep worktree and branch after merge
  destroy   --all                  Remove all worktrees, config, and state
            -y, --yes              Skip confirmation prompt
  prompt    -p, --prompt <text>    Set or update a workstream's prompt
  dashboard -e, --editor <editor>  Open directly in a specific editor
            --no-editor            Print worktree path without opening editor
  logs      --raw                  Print raw log output instead of interactive viewer

Run "ws <command> --help" for detailed usage and examples.
`);

program.addCommand(initCommand());
program.addCommand(createCommand());
program.addCommand(runCommand());
program.addCommand(listCommand());
program.addCommand(dashboardCommand());
program.addCommand(diffCommand());
program.addCommand(mergeCommand());
program.addCommand(logsCommand());
program.addCommand(destroyCommand());
program.addCommand(promptCommand());
program.addCommand(checkoutCommand());

program.parse();
