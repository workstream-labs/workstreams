#!/usr/bin/env bun

import { Command } from "commander";
import { initCommand } from "./cli/init";
import { runCommand } from "./cli/run";
import { statusCommand } from "./cli/status";
import { destroyCommand } from "./cli/destroy";
import { createCommand } from "./cli/create";
import { listCommand } from "./cli/list";
import { switchCommand } from "./cli/switch";
import { diffCommand } from "./cli/diff";
import { logCommand } from "./cli/log";
import { dashboardCommand } from "./cli/dashboard";

const program = new Command();

program
  .name("ws")
  .description("Orchestrate parallel AI coding agents via DAGs")
  .version("0.1.0");

program.addCommand(initCommand());
program.addCommand(runCommand());
program.addCommand(statusCommand());
program.addCommand(destroyCommand());
program.addCommand(createCommand());
program.addCommand(listCommand());
program.addCommand(switchCommand());
program.addCommand(diffCommand());
program.addCommand(logCommand());
program.addCommand(dashboardCommand());

program.parse();
