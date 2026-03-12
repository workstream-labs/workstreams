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
