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

export async function promptChoice(message: string, choices: string[]): Promise<number> {
  console.log(message);
  for (let i = 0; i < choices.length; i++) {
    console.log(`  ${i + 1}. ${choices[i]}`);
  }
  const answer = await prompt("Choice: ");
  const n = parseInt(answer, 10);
  if (isNaN(n) || n < 1 || n > choices.length) return -1;
  return n;
}
