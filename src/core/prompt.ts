import { createInterface } from "readline";

function createRL() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

export function prompt(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createRL();
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function promptChoice(message: string, choices: string[]): Promise<number> {
  return new Promise((resolve) => {
    const cyan = "\x1b[36m";
    const bold = "\x1b[1m";
    const dim = "\x1b[2m";
    const green = "\x1b[32m";
    const reset = "\x1b[0m";

    const renderChoices = (selected: number) => {
      for (let i = 0; i < choices.length; i++) {
        if (i === selected) {
          process.stdout.write(`${bold}${cyan}❯ ${choices[i]}${reset}\n`);
        } else {
          process.stdout.write(`${dim}  ${choices[i]}${reset}\n`);
        }
      }
    };

    process.stdout.write(`${message}\n`);
    let selected = 0;
    renderChoices(selected);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const redraw = (newSelected: number) => {
      // Move cursor up to overwrite choice lines
      process.stdout.write(`\x1b[${choices.length}A`);
      for (let i = 0; i < choices.length; i++) {
        process.stdout.write("\x1b[2K\r");
        if (i === newSelected) {
          process.stdout.write(`${bold}${cyan}❯ ${choices[i]}${reset}\n`);
        } else {
          process.stdout.write(`${dim}  ${choices[i]}${reset}\n`);
        }
      }
    };

    const onData = (key: string) => {
      if (key === "\x1b[A" || key === "k") {
        // Up
        const next = selected > 0 ? selected - 1 : choices.length - 1;
        selected = next;
        redraw(selected);
      } else if (key === "\x1b[B" || key === "j") {
        // Down
        const next = selected < choices.length - 1 ? selected + 1 : 0;
        selected = next;
        redraw(selected);
      } else if (key === "\r" || key === " ") {
        // Confirm
        cleanup();
        // Overwrite menu: move up past choices + prompt line, then print confirmation
        process.stdout.write(`\x1b[${choices.length + 1}A`);
        for (let i = 0; i < choices.length + 1; i++) {
          process.stdout.write("\x1b[2K\r\n");
        }
        process.stdout.write(`\x1b[${choices.length + 1}A`);
        process.stdout.write(`${green}✔${reset} ${choices[selected]}\n`);
        resolve(selected + 1);
      } else if (key === "\x03" || key === "\x1b") {
        // Cancel
        cleanup();
        process.stdout.write(`\x1b[${choices.length + 1}A`);
        for (let i = 0; i < choices.length + 1; i++) {
          process.stdout.write("\x1b[2K\r\n");
        }
        process.stdout.write(`\x1b[${choices.length + 1}A`);
        resolve(-1);
      }
    };

    stdin.on("data", onData);
  });
}
