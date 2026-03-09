#!/usr/bin/env bun

import { Command } from "commander";
import { initCommand } from "./cli/init";
import { runCommand } from "./cli/run";
import { statusCommand } from "./cli/status";
import { destroyCommand } from "./cli/destroy";
import { createCommand } from "./cli/create";
import { listCommand } from "./cli/list";
import { diffCommand } from "./cli/diff";
import { mergeCommand } from "./cli/merge";
import { checkoutCommand } from "./cli/checkout";
import { resumeCommand } from "./cli/resume";
import { switchCommand } from "./cli/switch";

const program = new Command();

program
  .name("ws")
  .description("Orchestrate parallel AI coding agents")
  .version("0.1.0");

program.addCommand(initCommand());
program.addCommand(runCommand());
program.addCommand(statusCommand());
program.addCommand(destroyCommand());
program.addCommand(createCommand());
program.addCommand(listCommand());
program.addCommand(diffCommand());
program.addCommand(mergeCommand());
program.addCommand(checkoutCommand());
program.addCommand(resumeCommand());
program.addCommand(switchCommand());

program.parse();
