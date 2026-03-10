#!/usr/bin/env bun

import { Command } from "commander";
import { initCommand } from "./cli/init";
import { runCommand } from "./cli/run";

import { destroyCommand } from "./cli/destroy";
import { createCommand } from "./cli/create";
import { listCommand } from "./cli/list";
import { diffCommand } from "./cli/diff";
import { mergeCommand } from "./cli/merge";
import { resumeCommand } from "./cli/resume";
import { switchCommand } from "./cli/switch";

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
  ws list                        Check status
  ws switch                      Open interactive dashboard
  ws merge auth                  Merge completed work
  ws destroy --all               Tear everything down

Key options:
  init      -f, --force            Reinitialize even if already set up
  create    -p, --prompt <text>    Prompt for the agent
            --plan-first           Pause for review after planning phase
  run       -d, --dry-run          Preview which workstreams would run
  diff      --raw                  Print raw diff instead of interactive viewer
  resume    -p, --prompt <text>    New prompt to send to the agent
            --comments             Resume using stored review comments
  merge     --all                  Merge all successful workstreams
            --squash               Squash commits into a single commit
            --no-cleanup           Keep worktree and branch after merge
  destroy   --all                  Remove all worktrees, config, and state
            -y, --yes              Skip confirmation prompt
  switch    -e, --editor <editor>  Open directly in a specific editor
            --no-editor            Print worktree path without opening editor

Run "ws <command> --help" for detailed usage and examples.
`);

program.addCommand(initCommand());
program.addCommand(createCommand());
program.addCommand(runCommand());
program.addCommand(listCommand());
program.addCommand(switchCommand());
program.addCommand(diffCommand());
program.addCommand(resumeCommand());
program.addCommand(mergeCommand());
program.addCommand(destroyCommand());

program.parse();
